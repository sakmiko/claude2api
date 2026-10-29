package adapter

import (
	"claude2api/internal/service"
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSlowStreamsStayAliveAndStopHeartbeat(t *testing.T) {
	oldRunner, oldInterval := runner, sseHeartbeatInterval
	defer func() { runner = oldRunner; sseHeartbeatInterval = oldInterval }()
	sseHeartbeatInterval = 5 * time.Millisecond
	runner = testRunner(func(_ string, prompt service.Prompt, emit func(string)) (service.CompletionResult, error) {
		if prompt.Context == nil {
			t.Error("missing request context")
		}
		time.Sleep(35 * time.Millisecond)
		emit("ok")
		return service.CompletionResult{StatusCode: 200}, nil
	})
	for _, tc := range []struct {
		path, body, heartbeat, end string
		handler                    gin.HandlerFunc
	}{
		{"/v1/chat/completions", `{"stream":true,"messages":[{"role":"user","content":"hi"}]}`, ": keepalive", "data: [DONE]", OpenAIChat},
		{"/v1/messages", `{"stream":true,"messages":[{"role":"user","content":"hi"}]}`, "event: ping", "event: message_stop", AnthropicMessages},
		{"/v1/responses", `{"stream":true,"input":"hi"}`, ": keepalive", "event: response.completed", OpenAIResponses},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest("POST", tc.path, strings.NewReader(tc.body))
			tc.handler(c)
			body := w.Body.String()
			if !strings.Contains(body, tc.heartbeat) || !strings.Contains(body, tc.end) {
				t.Fatal(body)
			}
			if w.Header().Get("X-Accel-Buffering") != "no" || !strings.Contains(w.Header().Get("Cache-Control"), "no-transform") {
				t.Fatal("missing streaming headers")
			}
			stream, _ := c.Get(sseContextKey)
			select {
			case <-stream.(*sseWriter).stopped:
			default:
				t.Fatal("heartbeat leaked after handler")
			}
		})
	}
}

func TestResponsesThinkingFilterEveryChunkBoundary(t *testing.T) {
	input := "Before <think>internal text</think> after <think>more</think> done"
	for size := 1; size <= len(input); size++ {
		f := thinkingFilter{}
		var got strings.Builder
		for i := 0; i < len(input); i += size {
			got.WriteString(f.push(input[i:min(i+size, len(input))], false))
		}
		got.WriteString(f.push("", true))
		if got.String() != "Before  after  done" {
			t.Fatalf("size=%d output=%q", size, got.String())
		}
	}
	f := thinkingFilter{}
	if got := f.push("visible<think>unfinished", true); got != "visible" {
		t.Fatal(got)
	}
}

func TestStreamErrorsAreProtocolEvents(t *testing.T) {
	old := runner
	defer func() { runner = old }()
	runner = testRunner(func(_ string, _ service.Prompt, emit func(string)) (service.CompletionResult, error) {
		emit("partial")
		return service.CompletionResult{}, errors.New("upstream failed")
	})
	for _, tc := range []struct {
		path, body, want, forbidden string
		handler                     gin.HandlerFunc
	}{
		{"/v1/messages", `{"stream":true,"messages":[{"role":"user","content":"hi"}]}`, "event: error", "event: message_stop", AnthropicMessages},
		{"/v1/responses", `{"stream":true,"input":"hi"}`, "event: response.failed", "event: response.completed", OpenAIResponses},
	} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", tc.path, strings.NewReader(tc.body))
		tc.handler(c)
		body := w.Body.String()
		if !strings.Contains(body, tc.want) || strings.Contains(body, tc.forbidden) || strings.Contains(body, `"stop_reason":"error"`) {
			t.Fatal(body)
		}
	}
}

func TestRequestCancellationReachesRunner(t *testing.T) {
	old := runner
	defer func() { runner = old }()
	started, finished := make(chan struct{}), make(chan struct{})
	runner = testRunner(func(_ string, prompt service.Prompt, _ func(string)) (service.CompletionResult, error) {
		close(started)
		<-prompt.Context.Done()
		close(finished)
		return service.CompletionResult{}, prompt.Context.Err()
	})
	r := gin.New()
	r.POST("/v1/chat/completions", OpenAIChat)
	server := httptest.NewServer(r)
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", server.URL+"/v1/chat/completions", strings.NewReader(`{"stream":true,"messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	<-started
	cancel()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("client disconnect did not reach runner")
	}
}
