package repository

import (
	"claude2api/internal/config"
	"os"
	"testing"
	"time"
)

func TestLimitUpdatePreservesAccountFields(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.WriteFile("config.example.yaml", []byte("admin_password: test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	config.Load()
	if err := InitDB(); err != nil {
		t.Fatal(err)
	}
	account := Account{Email: "quota@example.com", Status: "active", OrgUUID: "org-1", Cookies: map[string]string{"sessionKey": "keep-this-session"}}
	if err := UpsertAccount(&account); err != nil {
		t.Fatal(err)
	}
	oldRefresh := account.UpdatedAt
	remaining := 3
	if !UpdateAccountSessionLimits(account.Email, &SessionLimits{Remaining: &remaining}) {
		t.Fatal("update failed")
	}
	got := AccountByEmail(account.Email)
	if got.Status != "active" || got.Cookies["sessionKey"] != "keep-this-session" || got.OrgUUID != "org-1" || !got.UpdatedAt.Equal(oldRefresh) || got.SessionLimits == nil || got.SessionLimits.Remaining == nil || *got.SessionLimits.Remaining != 3 || got.LastLimitUpdate == nil {
		t.Fatalf("account fields or quota lost: %#v", got)
	}
	if UpdateAccountSessionLimits("missing@example.com", &SessionLimits{}) {
		t.Fatal("missing account should not be created")
	}
}

func TestSchedulingPolicyAndRecentSummary(t *testing.T) {
	t.Chdir(t.TempDir())
	os.WriteFile("config.example.yaml", []byte("admin_password: test\n"), 0600)
	config.Load()
	if err := InitDB(); err != nil {
		t.Fatal(err)
	}
	a := Account{Email: "policy@example.com", Status: "active", Cookies: map[string]string{"sessionKey": "preserve"}}
	if err := UpsertAccount(&a); err != nil {
		t.Fatal(err)
	}
	until := time.Now().Add(time.Hour)
	if !PauseAccount(a.Email, true) || !CooldownAccount(a.Email, until, "limited") {
		t.Fatal("policy write failed")
	}
	got := AccountByEmail(a.Email)
	if !got.Paused || got.CooldownUntil == nil || !got.CooldownUntil.Equal(until) || got.Cookies["sessionKey"] != "preserve" {
		t.Fatalf("policy or credentials lost: %#v", got)
	}
	if err := UpsertAccount(&Account{Email: a.Email, Status: "active", Cookies: map[string]string{"sessionKey": "new-session"}}); err != nil {
		t.Fatal(err)
	}
	if got := AccountByEmail(a.Email); !got.Paused || got.CooldownUntil == nil || got.Cookies["sessionKey"] != "new-session" {
		t.Fatal("re-import reset policy")
	}
	if !PauseAccount(a.Email, false) || AccountByEmail(a.Email).Paused {
		t.Fatal("resume failed")
	}
	InsertAPILog(APILog{Success: true, DurationMs: 200})
	InsertAPILog(APILog{Success: false, DurationMs: 1000})
	InsertAPILog(APILog{Success: true, DurationMs: 10000, CreatedAt: time.Now().UTC().Add(-25 * time.Hour).Format(time.RFC3339)})
	summary := RecentSummary()
	if summary.Requests != 2 || summary.Succeeded != 1 || summary.AverageMs != 200 {
		t.Fatalf("wrong summary %#v", summary)
	}
}
