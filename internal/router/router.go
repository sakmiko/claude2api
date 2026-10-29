package router

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"claude2api/internal/adapter"
	"claude2api/internal/config"
	"claude2api/internal/handler"
	"claude2api/internal/middleware"
	"claude2api/internal/repository"
	"claude2api/internal/service"
	"claude2api/web"

	"github.com/gin-gonic/gin"
)

// NewMainEngine 构造主站引擎。
func NewMainEngine() *gin.Engine {
	r := gin.Default()
	r.Use(func(c *gin.Context) {
		if c.Request.URL.Path == "/v1" || strings.HasPrefix(c.Request.URL.Path, "/v1/") {
			c.Header("Access-Control-Allow-Origin", "*")
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, Anthropic-Version, Anthropic-Beta, X-Stainless-Lang, X-Stainless-Package-Version, X-Stainless-OS, X-Stainless-Arch, X-Stainless-Runtime, X-Stainless-Runtime-Version, X-Stainless-Retry-Count, X-Stainless-Timeout, Anthropic-Dangerous-Direct-Browser-Access")
			if c.Request.Method == http.MethodOptions {
				c.AbortWithStatus(http.StatusNoContent)
				return
			}
		}
		c.Next()
	})
	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	admin := r.Group("/api")
	admin.Use(middleware.AdminAuth())
	admin.POST("/login", handler.AdminLogin)
	admin.POST("/logout", handler.AdminLogout)

	admin.GET("/status", func(c *gin.Context) {
		accounts := repository.LoadAccounts()
		usable := 0
		paused, cooling := 0, 0
		for i := range accounts {
			if accounts[i].Paused {
				paused++
			}
			if accounts[i].CooldownUntil != nil && accounts[i].CooldownUntil.After(time.Now()) {
				cooling++
			}
			if service.AccountUsable(&accounts[i]) {
				usable++
			}
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok", "accounts": len(accounts), "usable_accounts": usable,
			"protocols":          []string{"OpenAI Chat Completions", "OpenAI Responses", "Anthropic Messages"},
			"session_auto_renew": false, "upstream_verified": false, "paused": paused, "cooling": cooling, "recent": repository.RecentSummary()})
	})
	admin.GET("/accounts", handler.AdminAccounts)
	admin.GET("/accounts/session-limits", handler.AdminSessionLimits)
	admin.POST("/accounts/import", handler.AdminImportAccounts)
	admin.POST("/accounts/pause", handler.AdminPauseAccount)
	admin.POST("/accounts/refresh", handler.AdminRefreshAccount)
	admin.GET("/config", handler.AdminGetConfig)
	admin.POST("/config", handler.AdminUpdateConfig)
	admin.POST("/delete", handler.AdminDeleteAccount)
	admin.POST("/delete-expired", handler.AdminDeleteExpired)

	admin.GET("/keys", handler.AdminListKeys)
	admin.POST("/keys", handler.AdminCreateKey)
	admin.POST("/keys/delete", handler.AdminDeleteKey)

	admin.GET("/logs", handler.AdminListLogs)
	admin.GET("/logs/:id", handler.AdminGetLog)
	admin.POST("/logs/delete", handler.AdminDeleteLogs)

	pool := r.Group("/pool")
	pool.Use(middleware.PoolAuth())
	pool.GET("/api/current", handler.PoolCurrent)
	pool.GET("/api/list", handler.PoolList)
	pool.GET("/api/select", handler.PoolSelect)
	pool.POST("/api/refresh", handler.PoolRefreshCurrent)

	// 2api 必须早于 NoRoute 反代。
	api := r.Group("/v1")
	api.Use(middleware.APIKey())
	api.Use(func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, adapter.MaxAPIBodyBytes)
		c.Next()
	})
	api.GET("/models", adapter.ListModels)
	api.POST("/chat/completions", adapter.OpenAIChat)
	api.POST("/responses", adapter.OpenAIResponses)
	api.POST("/messages", adapter.AnthropicMessages)

	r.StaticFS("/static", http.FS(web.FS))
	r.GET("/", page("index.html"))

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/v1" || strings.HasPrefix(path, "/v1/") || strings.HasPrefix(path, "/pool/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"type": "invalid_request_error", "message": "Unknown API endpoint; use /v1/chat/completions, /v1/responses or /v1/messages"}})
			return
		}
		handler.ServeMainProxy(c)
	})
	return r
}

func newSinglePortHandler() http.Handler {
	mainEngine := NewMainEngine()
	ucEngine := gin.Default()
	ucEngine.NoRoute(handler.ServeUCProxy)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Legacy configurations used localhost for the sandbox, hiding the login
		// screen and API behind artifact authentication. Reserve app endpoints.
		path := r.URL.Path
		appPath := path == "/" || path == "/healthz" || path == "/new" || strings.HasPrefix(path, "/static/") || strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/v1/") || strings.HasPrefix(path, "/pool/")
		if handler.IsUCHost(r.Host) && !appPath {
			ucEngine.ServeHTTP(w, r)
			return
		}
		mainEngine.ServeHTTP(w, r)
	})
}

func page(name string) gin.HandlerFunc {
	data, err := web.FS.ReadFile(name)
	if err != nil {
		panic(err)
	}
	return func(c *gin.Context) { c.Data(http.StatusOK, "text/html; charset=utf-8", data) }
}

// RunServer 启动 Web 服务。
func RunServer() {
	s := config.Get()
	gin.SetMode(gin.ReleaseMode)

	addr := fmt.Sprintf("%s:%d", s.WebHost, s.WebPort)
	fmt.Printf("[web] 镜像 + 管理已启动: http://%s\n", addr)
	fmt.Printf("[web]   管理与号池入口:        http://%s/\n", addr)
	fmt.Printf("[web]   镜像站(claude.ai):     选择账号后进入\n")
	fmt.Printf("[web]   artifact 沙箱与主站共用端口\n")
	fmt.Println("[web] 按 Ctrl+C 停止")
	server := http.Server{Addr: addr, Handler: newSinglePortHandler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	if err := server.ListenAndServe(); err != nil {
		slog.Error("[web] 主站启动失败", "err", err)
	}
}
