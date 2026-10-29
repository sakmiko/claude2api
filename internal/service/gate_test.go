package service

import (
	"claude2api/internal/repository"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"
)

func gateAccount(email string) repository.Account {
	return repository.Account{Email: email, Status: "active", Cookies: map[string]string{"sessionKey": "fixture"}}
}
func TestGateDoesNotQueueOrReuseBusyAccount(t *testing.T) {
	g := accountGate{}
	accounts := []repository.Account{gateAccount("a"), gateAccount("b")}
	now := time.Now()
	first, releaseA := g.reserve(accounts, nil, now, 2*time.Second)
	second, releaseB := g.reserve(accounts, nil, now, 2*time.Second)
	if first == nil || second == nil || first.Email == second.Email {
		t.Fatal("busy account reused")
	}
	if a, _ := g.reserve(accounts, nil, now, 0); a != nil {
		t.Fatal("busy accounts must not queue")
	}
	releaseA()
	releaseA()
	releaseB()
	if a, _ := g.reserve(accounts, nil, now.Add(time.Second), 2*time.Second); a != nil {
		t.Fatal("minimum spacing ignored")
	}
	a, release := g.reserve(accounts, map[string]bool{first.Email: true}, now.Add(3*time.Second), 2*time.Second)
	if a == nil || a.Email == first.Email {
		t.Fatal("retry reused attempted account")
	}
	release()
}
func TestGateConcurrentReserve(t *testing.T) {
	g := accountGate{}
	accounts := []repository.Account{gateAccount("a")}
	var wg sync.WaitGroup
	var lock sync.Mutex
	success := 0
	attempted := make(chan struct{}, 40)
	finish := make(chan struct{})
	for i := 0; i < 40; i++ {
		wg.Go(func() {
			a, release := g.reserve(accounts, nil, time.Now(), time.Hour)
			if a != nil {
				lock.Lock()
				success++
				lock.Unlock()
			}
			attempted <- struct{}{}
			<-finish
			release()
		})
	}
	for i := 0; i < 40; i++ {
		<-attempted
	}
	close(finish)
	wg.Wait()
	if success != 1 {
		t.Fatalf("reserved=%d", success)
	}
}
func TestGateSkipsPausedAndCoolingAccounts(t *testing.T) {
	paused, cooling := gateAccount("paused"), gateAccount("cooling")
	paused.Paused = true
	until := time.Now().Add(time.Hour)
	cooling.CooldownUntil = &until
	g := accountGate{}
	if a, _ := g.reserve([]repository.Account{paused, cooling}, nil, time.Now(), 0); a != nil {
		t.Fatal("paused or cooling account selected")
	}
}
func TestCooldownHonorsUpstreamBoundaries(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	account := gateAccount("a")
	reset := now.Add(5 * time.Hour)
	account.SessionLimits = &repository.SessionLimits{Resolved: &repository.ResolvedLimit{Limit: &repository.Limit{ResetsAt: reset.Format(time.RFC3339)}}}
	if got := cooldownUntil(&account, 429, errors.New("limited"), now, 300); !got.Equal(reset) {
		t.Fatalf("ignored reset %v", got)
	}
	err := &CompletionError{StatusCode: 429, RetryAfter: 8 * time.Hour, Err: errors.New("limited")}
	if got := cooldownUntil(&account, 429, err, now, 300); !got.Equal(now.Add(8 * time.Hour)) {
		t.Fatalf("ignored Retry-After %v", got)
	}
	if got := cooldownUntil(&account, 400, errors.New("bad input"), now, 300); !got.IsZero() {
		t.Fatal("input error cooled account")
	}
	if got := cooldownUntil(&account, 503, errors.New("unavailable"), now, 300); !got.Equal(now.Add(30 * time.Second)) {
		t.Fatal("transient cooldown wrong")
	}
	if parseRetryAfter("120", now) != 2*time.Minute || parseRetryAfter(now.Add(time.Hour).Format(http.TimeFormat), now) != time.Hour || parseRetryAfter("bad", now) != 0 {
		t.Fatal("Retry-After parsing")
	}
}
