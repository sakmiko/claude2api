package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

// Settings 是运行时配置。
type Settings struct {
	RequestIntervalSeconds     int    `json:"request_interval_seconds" yaml:"request_interval_seconds"`
	AccountCooldownSeconds     int    `json:"account_cooldown_seconds" yaml:"account_cooldown_seconds"`
	Proxy                      string `json:"proxy" yaml:"proxy"`
	WebHost                    string `json:"web_host" yaml:"web_host"`
	WebPort                    int    `json:"web_port" yaml:"-"`
	WebUCHost                  string `json:"-" yaml:"web_uc_host"`
	AdminPassword              string `json:"-" yaml:"admin_password"`
	StatusCheckIntervalSeconds int    `json:"status_check_interval_seconds" yaml:"status_check_seconds"`
	RetryCount                 int    `json:"retry_count" yaml:"retry_count"`
	ChatDelete                 bool   `json:"chat_delete" yaml:"delete_chat"`
	MaxChatHistoryLength       int    `json:"max_chat_history_length" yaml:"max_history_length"`
	RemoveInvalidAccount       bool   `json:"remove_invalid_account" yaml:"remove_invalid_account"`
	DetailedAPILog             bool   `json:"detailed_api_log" yaml:"detailed_api_log"`
}

var (
	baseDir    string
	configPath string

	current   Settings
	currentMu sync.RWMutex
)

// Load 加载配置。
func Load() {
	exe, err := os.Executable()
	if err == nil {
		baseDir = filepath.Dir(exe)
	} else {
		baseDir, _ = os.Getwd()
	}
	// 开发运行时优先使用当前目录的配置。
	if wd, err := os.Getwd(); err == nil {
		_, e1 := os.Stat(filepath.Join(wd, "config.yaml"))
		_, e2 := os.Stat(filepath.Join(wd, "config.example.yaml"))
		if e1 == nil || e2 == nil {
			baseDir = wd
		}
	}
	configPath = filepath.Join(baseDir, "config.yaml")
	if configured := strings.TrimSpace(os.Getenv("CLAUDE2API_CONFIG_PATH")); configured != "" {
		configPath = configured
	}
	ensureConfig(configPath)
	current = Settings{RequestIntervalSeconds: 2, AccountCooldownSeconds: 300, WebHost: "127.0.0.1", WebPort: 8787, WebUCHost: "uc.localhost", StatusCheckIntervalSeconds: 21600, ChatDelete: true, MaxChatHistoryLength: 12000}
	data, _ := os.ReadFile(configPath)
	_ = yaml.Unmarshal(data, &current)
	current.Proxy, _ = NormalizeProxy(current.Proxy)
	current.AdminPassword = strings.TrimSpace(current.AdminPassword)
	current.WebHost = strings.TrimSpace(current.WebHost)
	if current.WebHost == "" {
		current.WebHost = "127.0.0.1"
	}
	current.WebUCHost = strings.TrimSpace(current.WebUCHost)
	if current.WebUCHost == "" {
		current.WebUCHost = "uc.localhost"
	}
	if current.StatusCheckIntervalSeconds < 21600 {
		current.StatusCheckIntervalSeconds = 21600
	}
	if current.MaxChatHistoryLength <= 0 {
		current.MaxChatHistoryLength = 12000
	}
}

func Get() Settings {
	currentMu.RLock()
	defer currentMu.RUnlock()
	return current
}

// ensureConfig 缺配置时复制示例文件。
func ensureConfig(path string) {
	if _, err := os.Stat(path); err == nil {
		return
	}
	example := filepath.Join(filepath.Dir(path), "config.example.yaml")
	data, err := os.ReadFile(example)
	if err != nil {
		data, err = os.ReadFile(filepath.Join(baseDir, "config.example.yaml"))
	}
	if err != nil {
		slog.Warn("[配置] 未找到 config.yaml，也无 config.example.yaml 可复制，使用内置默认值", "err", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		slog.Warn("[配置] 创建配置目录失败", "err", err)
		return
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		slog.Warn("[配置] 复制 config.example.yaml 失败，使用内置默认值", "err", err)
		return
	}
	slog.Info("[配置] 未找到 config.yaml，已从 config.example.yaml 复制生成", "path", path)
}

// DataDir 返回数据目录。
func DataDir() string {
	return filepath.Join(baseDir, "data")
}

// DBPath 返回数据库路径。
func DBPath() string {
	return filepath.Join(DataDir(), "app.db")
}

func writeConfig(settings Settings) error {
	data, err := yaml.Marshal(&settings)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(configPath), ".config-*.tmp")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, configPath)
}

func Update(patch map[string]any) (Settings, error) {
	currentMu.Lock()
	defer currentMu.Unlock()
	next := current
	for k, v := range patch {
		switch k {
		case "proxy":
			next.Proxy, _ = NormalizeProxy(fmt.Sprint(v))
		case "admin_password":
			next.AdminPassword = strings.TrimSpace(fmt.Sprint(v))
		case "status_check_interval_seconds":
			next.StatusCheckIntervalSeconds = mustAtoi(v)
		case "request_interval_seconds":
			next.RequestIntervalSeconds = mustAtoi(v)
		case "account_cooldown_seconds":
			next.AccountCooldownSeconds = mustAtoi(v)
		case "retry_count":
			next.RetryCount = mustAtoi(v)
		case "chat_delete":
			next.ChatDelete = mustBool(v)
		case "max_chat_history_length":
			next.MaxChatHistoryLength = mustAtoi(v)
		case "remove_invalid_account":
			next.RemoveInvalidAccount = mustBool(v)
		case "detailed_api_log":
			next.DetailedAPILog = mustBool(v)
		}
	}
	if next.StatusCheckIntervalSeconds < 21600 {
		next.StatusCheckIntervalSeconds = 21600
	}
	if next.RetryCount < 0 {
		next.RetryCount = 0
	}
	if next.RetryCount > 8 {
		next.RetryCount = 8
	}
	if next.MaxChatHistoryLength <= 0 {
		next.MaxChatHistoryLength = 12000
	}
	next.RequestIntervalSeconds = max(0, min(next.RequestIntervalSeconds, 60))
	next.AccountCooldownSeconds = max(60, min(next.AccountCooldownSeconds, 86400))
	if err := writeConfig(next); err != nil {
		return current, err
	}
	current = next
	return current, nil
}

func mustAtoi(v any) int {
	n, _ := strconv.Atoi(strings.TrimSpace(fmt.Sprint(v)))
	return n
}

func mustBool(v any) bool {
	b, _ := strconv.ParseBool(strings.TrimSpace(fmt.Sprint(v)))
	return b
}

// NormalizeProxy accepts common host:port input and always returns an absolute URL.
func NormalizeProxy(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	u, err := url.Parse(value)
	if err != nil || u.Hostname() == "" {
		return "", fmt.Errorf("代理地址无效，请使用 http://127.0.0.1:7890")
	}
	switch u.Scheme {
	case "http", "https", "socks5", "socks5h":
	default:
		return "", fmt.Errorf("不支持的代理协议: %s", u.Scheme)
	}
	if u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("出口代理不能包含 API 路径、查询参数或片段")
	}
	return strings.TrimSuffix(u.String(), "/"), nil
}
