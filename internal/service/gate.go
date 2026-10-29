package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"claude2api/internal/config"
	"claude2api/internal/repository"
)

type gateSlot struct {
	busy      bool
	lastStart time.Time
}
type accountGate struct {
	sync.Mutex
	slots map[string]*gateSlot
	next  int
}

var apiGate = accountGate{slots: map[string]*gateSlot{}}

// reserve never queues requests behind a busy account or reuses an account in one retry cycle.
func (g *accountGate) reserve(accounts []repository.Account, excluded map[string]bool, now time.Time, interval time.Duration) (*repository.Account, func()) {
	g.Lock()
	defer g.Unlock()
	if len(accounts) == 0 {
		return nil, func() {}
	}
	if g.slots == nil {
		g.slots = map[string]*gateSlot{}
	}
	present := map[string]bool{}
	for _, a := range accounts {
		present[a.Email] = true
	}
	for email, slot := range g.slots {
		if !present[email] && !slot.busy {
			delete(g.slots, email)
		}
	}
	for offset := 0; offset < len(accounts); offset++ {
		i := (g.next + offset) % len(accounts)
		a := accounts[i]
		if excluded[a.Email] || !AccountUsable(&a) {
			continue
		}
		slot := g.slots[a.Email]
		if slot == nil {
			slot = &gateSlot{}
			g.slots[a.Email] = slot
		}
		if slot.busy || now.Sub(slot.lastStart) < interval {
			continue
		}
		slot.busy = true
		slot.lastStart = now
		g.next = (i + 1) % len(accounts)
		var once sync.Once
		return &a, func() { once.Do(func() { g.Lock(); slot.busy = false; g.Unlock() }) }
	}
	return nil, func() {}
}

func failureStatus(code int, err error) int {
	var upstream *CompletionError
	if errors.As(err, &upstream) && upstream.StatusCode >= 400 {
		return upstream.StatusCode
	}
	if code >= 400 {
		return code
	}
	if err == nil {
		return 0
	}
	text := err.Error()
	if strings.Contains(text, "account_session_invalid") || strings.Contains(text, "HTTP 401") {
		return 401
	}
	for _, item := range []struct {
		text string
		code int
	}{{"HTTP 429", 429}, {"rate limit exceeded", 429}, {"HTTP 403", 403}, {"HTTP 500", 500}, {"HTTP 502", 502}, {"HTTP 503", 503}} {
		if strings.Contains(text, item.text) {
			return item.code
		}
	}
	return 0
}

// cooldownUntil honors known quota resets and Retry-After rather than hammering a limited session.
func cooldownUntil(account *repository.Account, code int, err error, now time.Time, seconds int) time.Time {
	code = failureStatus(code, err)
	if code != 429 && code != 403 && code < 500 {
		return time.Time{}
	}
	duration := time.Duration(seconds) * time.Second
	if duration < time.Minute {
		duration = time.Minute
	}
	if code >= 500 {
		duration = 30 * time.Second
	}
	until := now.Add(duration)
	var upstream *CompletionError
	if errors.As(err, &upstream) && upstream.RetryAfter > 0 {
		if t := now.Add(upstream.RetryAfter); t.After(until) {
			until = t
		}
	}
	if code == 429 && account.SessionLimits != nil && account.SessionLimits.Resolved != nil && account.SessionLimits.Resolved.Limit != nil {
		if reset, e := time.Parse(time.RFC3339, account.SessionLimits.Resolved.Limit.ResetsAt); e == nil && reset.After(until) {
			until = reset
		}
	}
	return until
}

func recordAccountFailure(account *repository.Account, code int, err error) {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return
	}
	code = failureStatus(code, err)
	if code == 401 {
		repository.UpdateAccount(account.Email, func(a *repository.Account) { a.Status = "expired" })
		return
	}
	if until := cooldownUntil(account, code, err, time.Now(), config.Get().AccountCooldownSeconds); !until.IsZero() {
		reason := "暂时不可用"
		if code == 429 {
			reason = "额度受限"
		} else if code == 403 {
			reason = "访问受限"
		}
		repository.CooldownAccount(account.Email, until, reason)
	}
}
