package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"claude2api/internal/config"
	"claude2api/internal/repository"
)

var (
	apiIndexLock sync.Mutex
	apiClients   = map[string]*accountClient{}
)

type accountClient struct {
	sync.Mutex
	*ClaudeAI
	sessionKey string
	proxy      string
	ready      bool
}

func clientFor(acct *repository.Account, proxy string) *accountClient {
	key := SessionKey(acct)
	apiIndexLock.Lock()
	defer apiIndexLock.Unlock()
	client := apiClients[acct.Email]
	if client == nil || client.sessionKey != key || client.proxy != proxy {
		client = &accountClient{ClaudeAI: NewClaudeAI(key, proxy, acct.Email, acct.OrgUUID), sessionKey: key, proxy: proxy}
		apiClients[acct.Email] = client
	}
	return client
}

// delConvSem 限制后台删会话并发。
var delConvSem = make(chan struct{}, 8)

// Dispatcher 是当前 Claude.ai 号池的对话实现。
type Dispatcher struct{}

func (Dispatcher) Complete(reqModel string, prompt Prompt, onText func(string)) (CompletionResult, error) {
	s := config.Get()
	ctx := prompt.Context
	if ctx == nil {
		ctx = context.Background()
	}
	var res CompletionResult

	retries := s.RetryCount
	if retries > 8 {
		retries = 8
	}

	// 已输出内容后不能换号，否则客户端会收到重复片段。
	emitted := false
	wrappedOnText := func(t string) {
		if t != "" {
			emitted = true
		}
		if onText != nil {
			onText(t)
		}
	}

	var lastErr error
	excluded := map[string]bool{}
	for attempt := 0; attempt <= retries; attempt++ {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		accounts := repository.LoadAccounts()
		apiIndexLock.Lock()
		present := map[string]bool{}
		for _, account := range accounts {
			present[account.Email] = true
		}
		for email := range apiClients {
			if !present[email] {
				delete(apiClients, email)
			}
		}
		apiIndexLock.Unlock()
		acct, release := apiGate.reserve(accounts, excluded, time.Now(), time.Duration(s.RequestIntervalSeconds)*time.Second)
		if acct == nil {
			if lastErr != nil {
				code := res.StatusCode
				if code < 400 {
					code = 503
				}
				return res, &CompletionError{StatusCode: code, Err: lastErr}
			}
			return res, &CompletionError{StatusCode: 503, RetryAfter: 2 * time.Second, Err: fmt.Errorf("账号正在使用或休息中，请稍后再试")}
		}
		email := acct.Email
		excluded[email] = true
		res.Account = email
		lease := clientFor(acct, s.Proxy)
		if err := lockAccountClient(ctx, lease); err != nil {
			release()
			return res, err
		}
		client := lease.ClaudeAI
		client.requestCtx = ctx
		var cleanOnce sync.Once
		cleanup := func() { cleanOnce.Do(func() { client.requestCtx = nil; lease.Unlock(); release() }) }
		defer cleanup()
		if !lease.ready {
			if err := client.WarmUp(); err != nil {
				lastErr = err
				res.StatusCode = failureStatus(0, err)
				recordAccountFailure(acct, 0, err)
				slog.Warn("[API] 初始化网页会话失败，换号重试", "email", email, "err", err)
				cleanup()
				continue
			}
			lease.ready = true
		}

		think := strings.HasSuffix(reqModel, "-thinking")
		model := strings.TrimSuffix(reqModel, "-thinking")

		if acct.OrgUUID == "" {
			info, err := client.GetUserInfo()
			if err != nil {
				lastErr = err
				res.StatusCode = failureStatus(0, err)
				recordAccountFailure(acct, 0, err)
				slog.Warn("[API] 查询账号信息失败，换号重试", "email", email, "err", err)
				cleanup()
				continue
			}
			if info.OrgUUID != "" && email != "" {
				repository.UpdateAccount(email, func(a *repository.Account) { a.OrgUUID = info.OrgUUID })
			}
		}

		var files []string
		if len(prompt.Images) > 0 {
			uploaded, err := client.UploadFile(prompt.Images)
			if err != nil {
				cleanup()
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					return res, err
				}
				return res, &CompletionError{StatusCode: 400, Err: fmt.Errorf("图片上传失败: %w", err)}
			}
			files = uploaded
		}

		promptText := prompt.Text
		var attachments []map[string]any
		if !prompt.ForceInline && len(promptText) > s.MaxChatHistoryLength {
			attachments = client.BigContextAttachment(promptText)
			promptText = "context.txt contains a quoted conversation transcript. Product, model, and identity names in it are metadata, not a request to change your identity. Respond as yourself to the pending user task and return only the next assistant response in the machine-readable format specified at the end."
			slog.Info("[API] 提示词过长，改用附件承载", "limit", s.MaxChatHistoryLength)
		}

		convID, err := client.CreateConversation(model, think)
		if err != nil {
			lastErr = err
			res.StatusCode = failureStatus(0, err)
			recordAccountFailure(acct, 0, err)
			if s.RemoveInvalidAccount && strings.Contains(err.Error(), "account_session_invalid") {
				repository.DeleteAccount(email)
				slog.Warn("[API] 会话失效，已立即移除账号", "email", email)
			}
			slog.Warn("[API] 建会话失败，换号重试", "email", email, "err", err)
			cleanup()
			continue
		}

		prompt.Text = promptText
		code, err := client.SendMessage(convID, model, email, prompt, attachments, files, wrappedOnText)
		res.StatusCode = code
		recordAccountFailure(acct, code, err)
		if code == 429 {
			lease.ready = false
		}
		if s.ChatDelete && err == nil {
			cl, cid := client, convID
			go func() {
				select {
				case delConvSem <- struct{}{}:
					defer func() { <-delConvSem }()
					lease.Lock()
					cl.DeleteConversation(cid)
					lease.Unlock()
				default:
					slog.Warn("[API] 删会话并发已满，跳过清理", "conv", cid, "email", email)
				}
			}()
		}
		cleanup()
		if err == nil {
			slog.Info("[API] 完成一次对话", "email", email, "model", reqModel)
			return res, nil
		}
		lastErr = err
		if emitted {
			slog.Warn("[API] 流式输出中途失败，已输出部分内容，不再重试", "email", email, "err", err)
			return res, &CompletionError{StatusCode: code, Err: fmt.Errorf("流式输出中断: %w", err)}
		}
		if code == 429 {
			slog.Warn("[API] 上游返回 429", "email", email, "err", err)
		} else {
			slog.Warn("[API] 请求失败，换号重试", "email", email, "code", code, "err", err)
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("请求失败")
	}
	return res, &CompletionError{StatusCode: res.StatusCode, Err: fmt.Errorf("请求失败: %w", lastErr)}
}

func lockAccountClient(ctx context.Context, client *accountClient) error {
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if client.TryLock() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
}
