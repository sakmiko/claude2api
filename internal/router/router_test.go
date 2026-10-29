package router

import (
	"claude2api/internal/config"
	"claude2api/internal/repository"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestLocalGatewayRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Chdir(t.TempDir())
	if err := os.WriteFile("config.example.yaml", []byte("admin_password: route-test-password\n"), 0600); err != nil {
		t.Fatal(err)
	}
	config.Load()
	if err := repository.InitDB(); err != nil {
		t.Fatal(err)
	}
	engine := NewMainEngine()
	for _, host := range []string{"localhost:8787", "127.0.0.1:8787", "uc.localhost:8787"} {
		req := httptest.NewRequest("GET", "http://"+host+"/", nil)
		w := httptest.NewRecorder()
		newSinglePortHandler().ServeHTTP(w, req)
		if w.Code != 200 || !strings.Contains(w.Body.String(), "connection-input") {
			t.Fatalf("host=%s status=%d", host, w.Code)
		}
	}
	account := repository.Account{Email: "select@example.com", Status: "active", Cookies: map[string]string{"sessionKey": "fixture"}}
	if err := repository.UpsertAccount(&account); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/pool/api/select", nil)
	req.Header.Set("Authorization", "Bearer route-test-password")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != 302 || w.Header().Get("Location") != "/new" {
		t.Fatalf("auto-select failed: %d", w.Code)
	}
	found := false
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == "pool_acct" && cookie.Value == url.QueryEscape(account.Email) {
			found = true
		}
	}
	if !found {
		t.Fatal("auto-select must select an account")
	}
	repository.PauseAccount(account.Email, true)
	req = httptest.NewRequest("GET", "/pool/api/select?email=select@example.com", nil)
	req.Header.Set("Authorization", "Bearer route-test-password")
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != 409 {
		t.Fatal("paused account selected")
	}

	for _, tc := range []struct {
		method, path, body, token string
		status                    int
		want                      string
	}{
		{"GET", "/", "", "", 200, "connection-input"},
		{"GET", "/api/organizations/test/chat_conversations", "", "", 302, ""},
		{"GET", "/healthz", "", "", 200, `"status":"ok"`},
		{"GET", "/api/status", "", "", 401, "未登录"},
		{"GET", "/api/status", "", "route-test-password", 200, `"upstream_verified":false`},
		{"GET", "/v1/models", "", "", 401, "error"},
		{"GET", "/v1/models", "", "route-test-password", 200, "claude-sonnet-5-5"},
		{"OPTIONS", "/v1/chat/completions", "", "", 204, ""},
		{"GET", "/v1/not-supported", "", "", 404, "Unknown API endpoint"},
		{"POST", "/api/config", `{"proxy":"127.0.0.1:7890"}`, "route-test-password", 200, "http://127.0.0.1:7890"},
		{"POST", "/api/config", `{"proxy":"http://127.0.0.1:8787/v1"}`, "route-test-password", 400, "API 路径"},
		{"POST", "/api/config", `null`, "route-test-password", 400, "JSON 对象"},
	} {
		t.Run(tc.method+tc.path+tc.body, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.want) {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
			if strings.HasPrefix(tc.path, "/v1/") && w.Header().Get("Access-Control-Allow-Origin") != "*" {
				t.Error("missing API CORS")
			}
		})
	}
}
