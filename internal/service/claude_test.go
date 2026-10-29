package service

import (
	"context"
	"os"
	"strings"
	"testing"
)

func testClaude(t *testing.T) *ClaudeAI {
	t.Helper()
	key := os.Getenv("CLAUDE_SESSION_KEY")
	if key == "" {
		t.Skip("set CLAUDE_SESSION_KEY to run upstream integration tests")
	}
	client := NewClaudeAI(key, os.Getenv("CLAUDE_PROXY"), key)
	if err := client.WarmUp(); err != nil {
		t.Fatalf("WarmUp 失败: %v", err)
	}
	return client
}

func TestGetUserInfo(t *testing.T) {
	userInfo, err := testClaude(t).GetUserInfo()
	if err != nil {
		t.Fatalf("GetUserInfo 失败: %v", err)
	}
	t.Logf("user_info: %+v", userInfo)
}

func TestSendMessage(t *testing.T) {
	claudeAI := testClaude(t)
	_, err := claudeAI.GetUserInfo()
	if err != nil {
		t.Fatalf("GetUserInfo 失败: %v", err)
	}

	for i := 0; i < 3; i++ {
		convID, err := claudeAI.CreateConversation("claude-sonnet-5", false)
		if err != nil {
			t.Fatalf("CreateConversation 失败: %v", err)
		}
		var reply string
		status, err := claudeAI.SendMessage(convID, "claude-sonnet-5", "test@example.com", Prompt{Text: "只回复 OK"}, nil, nil, func(s string) { reply += s })
		if err != nil {
			t.Fatalf("第 %d 次 SendMessage 失败: status=%d err=%v", i+1, status, err)
		}
		t.Logf("第 %d 次 status=%d reply=%s", i+1, status, reply)
	}
}

func TestUploadFile(t *testing.T) {
	claudeAI := testClaude(t)
	_, err := claudeAI.GetUserInfo()
	if err != nil {
		t.Fatalf("GetUserInfo 失败: %v", err)
	}

	image := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

	fileUUIDs, err := claudeAI.UploadFile([]string{image})
	if err != nil {
		t.Fatalf("UploadFile 失败: %v", err)
	}
	if len(fileUUIDs) == 0 {
		t.Fatalf("UploadFile 未返回 file_uuid")
	}
	t.Logf("file_uuids: %v", fileUUIDs)
}

func TestScopedRequestUsesCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	client := &ClaudeAI{requestCtx: ctx}
	req, err := client.request("GET", "https://example.com", nil)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if req.Context().Err() != context.Canceled {
		t.Fatal("upstream request lost context")
	}
	lease := &accountClient{}
	lease.Lock()
	if err := lockAccountClient(ctx, lease); err != context.Canceled {
		t.Fatal("mutex wait ignored cancellation")
	}
	lease.Unlock()
}

func TestLegacyCompletionAndCompactSSE(t *testing.T) {
	var got strings.Builder
	input := "data:{\"completion\":\"legacy \"}\r\n\r\ndata:{\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"text\"}}\n\n"
	if err := parseCompletionSSE(strings.NewReader(input), "", func(s string) { got.WriteString(s) }); err != nil || got.String() != "legacy text" {
		t.Fatalf("%q %v", got.String(), err)
	}
}
