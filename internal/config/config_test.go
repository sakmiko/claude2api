package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeProxy(t *testing.T) {
	for _, tc := range []struct {
		input, want string
		invalid     bool
	}{
		{"", "", false},
		{"127.0.0.1:7890", "http://127.0.0.1:7890", false},
		{" socks5://127.0.0.1:1080/ ", "socks5://127.0.0.1:1080", false},
		{"https://proxy.example.com:443", "https://proxy.example.com:443", false},
		{"http://127.0.0.1:8787/v1/chat/completions", "", true},
		{"ftp://proxy.example.com", "", true},
		{"http://", "", true},
		{"http://[bad", "", true},
	} {
		t.Run(tc.input, func(t *testing.T) {
			got, err := NormalizeProxy(tc.input)
			if (err != nil) != tc.invalid || got != tc.want {
				t.Fatalf("got %q, %v; want %q, invalid=%v", got, err, tc.want, tc.invalid)
			}
		})
	}
}

func TestAtomicConfigSaveAndRollback(t *testing.T) {
	t.Setenv("CLAUDE2API_CONFIG_PATH", "")
	t.Chdir(t.TempDir())
	if err := os.WriteFile("config.example.yaml", []byte("admin_password: test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	Load()
	saved, err := Update(map[string]any{"retry_count": 3, "request_interval_seconds": 2})
	if err != nil || saved.RetryCount != 3 {
		t.Fatalf("save: %v", err)
	}
	info, err := os.Stat("config.yaml")
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("config should be owner-only")
	}
	configPath = filepath.Join("missing", "config.yaml")
	if _, err := Update(map[string]any{"retry_count": 7}); err == nil {
		t.Fatal("expected write failure")
	}
	if Get().RetryCount != 3 {
		t.Fatal("failed save changed live settings")
	}
}

func TestDirectoryMountedConfigPersistsAcrossReload(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	t.Setenv("CLAUDE2API_CONFIG_PATH", filepath.Join(root, "runtime-config", "config.yaml"))
	if err := os.WriteFile("config.example.yaml", []byte("admin_password: test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	Load()
	if _, err := Update(map[string]any{"retry_count": 4}); err != nil {
		t.Fatal(err)
	}
	Load()
	if Get().RetryCount != 4 || Get().AdminPassword != "test" {
		t.Fatal("directory-mounted configuration did not persist")
	}
	if DataDir() != filepath.Join(root, "data") {
		t.Fatal("configuration override changed the data directory")
	}
}
