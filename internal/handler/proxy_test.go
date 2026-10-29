package handler

import (
	"claude2api/internal/repository"
	"io"
	"strings"
	"testing"
)

func TestArtifactTicketDoesNotExposeCredential(t *testing.T) {
	token, err := issueArtifactTicket("admin-secret", "user@example.com")
	if err != nil || strings.Contains(token, "admin-secret") {
		t.Fatalf("invalid ticket: %q %v", token, err)
	}
	credential, email, path, ok := artifactAuth(authPrefix + token + "/artifact")
	if !ok || credential != "admin-secret" || email != "user@example.com" || path != "/artifact" {
		t.Fatalf("ticket lookup failed: %q %q %q %v", credential, email, path, ok)
	}
	if cookies := mergeProxyCookies("claude2api_auth=admin-secret; browser=1", "sessionKey=2"); strings.Contains(cookies, "admin-secret") {
		t.Fatalf("auth cookie leaked upstream: %s", cookies)
	}
}

// A fragmented stream must pass through unchanged and persist each limit once.
func TestSessionLimitCapturingReader(t *testing.T) {
	stream := "event: message_limit\r\ndata: {\"type\":\"message_limit\",\"message_limit\":{\"type\":\"within_limit\",\"remaining\":3}}\r\n\r\ndata: {\"type\":\"content_block_delta\"}\n\ndata:{\"type\":\"message_limit\",\"message_limit\":{\"remaining\":2}}"
	for _, chunk := range []int{1, 7, 64, 4096} {
		calls := 0
		r := &sessionLimitCapturingReader{Reader: strings.NewReader(stream), accountEmail: "test@example.com", onLimit: func(limit *repository.SessionLimits) {
			calls++
			if limit.Remaining == nil {
				t.Error("lost payload")
			}
		}}
		var out strings.Builder
		buf := make([]byte, chunk)
		for {
			n, err := r.Read(buf)
			out.Write(buf[:n])
			if err != nil {
				if err != io.EOF {
					t.Fatal(err)
				}
				break
			}
		}
		if out.String() != stream || calls != 2 {
			t.Fatalf("chunk=%d calls=%d bytes=%d", chunk, calls, out.Len())
		}
	}
}

func TestLimitReaderRecoversAfterOversizedLine(t *testing.T) {
	stream := "data:" + strings.Repeat("x", 2<<20) + "\ndata:{\"type\":\"message_limit\",\"message_limit\":{\"remaining\":1}}\n"
	calls := 0
	r := &sessionLimitCapturingReader{Reader: strings.NewReader(stream), accountEmail: "test", onLimit: func(*repository.SessionLimits) { calls++ }}
	if _, err := io.Copy(io.Discard, r); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || len(r.buffer) != 0 {
		t.Fatalf("calls=%d buffered=%d", calls, len(r.buffer))
	}
}
