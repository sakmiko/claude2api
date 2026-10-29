package handler

import (
	"log/slog"
	"net/http"

	"claude2api/internal/repository"
	"claude2api/internal/service"

	"github.com/gin-gonic/gin"
)

func PoolList(c *gin.Context) {
	current, _ := c.Cookie("pool_acct")
	items := []gin.H{}
	for _, account := range repository.LoadAccounts() {
		if service.SessionKey(&account) == "" || account.Status == "expired" {
			continue
		}
		status := account.Status
		if status == "" {
			status = "unknown"
		}
		items = append(items, gin.H{"email": account.Email, "status": status, "session_limits": account.SessionLimits, "last_limit_update": account.LastLimitUpdate, "paused": account.Paused, "cooldown_until": account.CooldownUntil, "cooldown_reason": account.CooldownReason})
	}
	c.JSON(http.StatusOK, gin.H{"accounts": items, "current": current})
}

func PoolSelect(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		for _, account := range repository.LoadAccounts() {
			if service.AccountUsable(&account) {
				email = account.Email
				break
			}
		}
	}
	if service.AccountByEmail(email) == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "暂无可用账号"})
		return
	}
	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetCookie("pool_acct", email, 31536000, "/", "", secure, true)
	c.SetCookie("mirror", "claude", 31536000, "/", "", secure, true)
	slog.Info("[号池] 切换当前账号", "email", email)
	c.Redirect(http.StatusFound, "/new")
}

// PoolRefreshCurrent refreshes and returns the current pool account's session limits
func PoolRefreshCurrent(c *gin.Context) {
	email, err := c.Cookie("pool_acct")
	if err != nil || email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No pool account selected"})
		return
	}

	account, removed := service.RefreshAccount(email)
	if removed {
		c.JSON(http.StatusOK, gin.H{"removed": true, "message": "Account was removed"})
		return
	}
	if account == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Account not found"})
		return
	}

	slog.Info("[号池] 刷新当前账号会话限制", "email", email)
	c.JSON(http.StatusOK, gin.H{"account": service.PublicAccountView(account)})
}

// PoolCurrent reads captured quota data without sending a refresh to Claude.
func PoolCurrent(c *gin.Context) {
	email, _ := c.Cookie("pool_acct")
	account := service.AccountByEmail(email)
	if account == nil {
		c.JSON(http.StatusOK, gin.H{"account": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"account": service.PublicAccountView(account)})
}
