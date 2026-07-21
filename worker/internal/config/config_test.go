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

func TestValidateConfigRejectsInvalidNucleiRefreshWindows(t *testing.T) {
	tests := []struct {
		name            string
		refreshInterval time.Duration
		maxStale        time.Duration
	}{
		{name: "zero refresh interval", refreshInterval: 0, maxStale: 24 * time.Hour},
		{name: "zero max stale", refreshInterval: 6 * time.Hour, maxStale: 0},
		{name: "refresh interval below job timeout", refreshInterval: 15 * time.Minute, maxStale: 24 * time.Hour},
		{name: "max stale below refresh interval", refreshInterval: 24 * time.Hour, maxStale: 6 * time.Hour},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cfg := validTestConfig()
			cfg.NucleiTemplateRefreshInterval = test.refreshInterval
			cfg.NucleiTemplateMaxStale = test.maxStale

			if err := validateConfig(cfg); err == nil {
				t.Fatal("invalid Nuclei template refresh configuration was accepted")
			}
		})
	}
}

func validTestConfig() *Config {
	return &Config{
		ApiKey:                        "a-strong-worker-enrollment-token-1234567890",
		JobTimeout:                    30 * time.Minute,
		JobStdoutLimitBytes:           16 * 1024 * 1024,
		JobStderrLimitBytes:           16 * 1024 * 1024,
		NucleiTemplateRefreshInterval: 6 * time.Hour,
		NucleiTemplateMaxStale:        24 * time.Hour,
	}
}
