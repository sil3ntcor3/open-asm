package config

import (
	"strings"
	"testing"
	"time"
)

func TestValidateConfigRejectsWeakEnrollmentTokens(t *testing.T) {
	for _, token := range []string{"", "change_me", "too-short"} {
		cfg := validTestConfig()
		cfg.ApiKey = token
		if err := validateConfig(cfg); err == nil || !strings.Contains(err.Error(), "at least 32 characters") {
			t.Fatalf("weak enrollment token %q was accepted: %v", token, err)
		}
	}
}

func validTestConfig() *Config {
	return &Config{
		ApiKey:              "a-strong-worker-enrollment-token-1234567890",
		JobTimeout:          30 * time.Minute,
		JobStdoutLimitBytes: 16 * 1024 * 1024,
		JobStderrLimitBytes: 16 * 1024 * 1024,
	}
}
