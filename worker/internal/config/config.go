package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/spf13/viper"
)

type Config struct {
	ApiKey                        string        `mapstructure:"api_key"`
	MaxConcurrency                int           `mapstructure:"max_concurrency"`
	GrpcHost                      string        `mapstructure:"grpc_host"`
	GrpcPort                      int           `mapstructure:"grpc_port"`
	GrpcTLSEnabled                bool          `mapstructure:"grpc_tls_enabled"`
	GrpcCAFile                    string        `mapstructure:"grpc_tls_ca_file"`
	GrpcCertFile                  string        `mapstructure:"grpc_tls_cert_file"`
	GrpcKeyFile                   string        `mapstructure:"grpc_tls_key_file"`
	GrpcServerName                string        `mapstructure:"grpc_tls_server_name"`
	ToolPath                      string        `mapstructure:"tool_path"`
	Network                       string        `mapstructure:"network"`
	JobTimeout                    time.Duration `mapstructure:"job_timeout"`
	JobStdoutLimitBytes           int64         `mapstructure:"job_stdout_limit_bytes"`
	JobStderrLimitBytes           int64         `mapstructure:"job_stderr_limit_bytes"`
	NucleiTemplateRefreshInterval time.Duration `mapstructure:"nuclei_template_refresh_interval"`
	NucleiTemplateMaxStale        time.Duration `mapstructure:"nuclei_template_max_stale"`
}

func LoadConfig() (*Config, error) {
	_ = godotenv.Load(".env")

	viper.SetEnvPrefix("WORKER")
	viper.SetEnvKeyReplacer(strings.NewReplacer("-", "_"))
	viper.AutomaticEnv()

	viper.SetDefault("api_key", "")
	viper.SetDefault("network", "")
	viper.SetDefault("max_concurrency", 10)
	viper.SetDefault("grpc_host", "localhost")
	viper.SetDefault("grpc_port", 16276)
	viper.SetDefault("grpc_tls_enabled", false)
	viper.SetDefault("grpc_tls_ca_file", "")
	viper.SetDefault("grpc_tls_cert_file", "")
	viper.SetDefault("grpc_tls_key_file", "")
	viper.SetDefault("grpc_tls_server_name", "")
	viper.SetDefault("tool_path", "oasm-tools")
	viper.SetDefault("job_timeout", 30*time.Minute)
	viper.SetDefault("job_stdout_limit_bytes", 16*1024*1024)
	viper.SetDefault("job_stderr_limit_bytes", 16*1024*1024)
	viper.SetDefault("nuclei_template_refresh_interval", 6*time.Hour)
	viper.SetDefault("nuclei_template_max_stale", 24*time.Hour)

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}
	if err := validateConfig(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func validateConfig(cfg *Config) error {
	if len(cfg.ApiKey) < 32 || cfg.ApiKey == "change_me" {
		return fmt.Errorf("worker enrollment token must be a non-default secret of at least 32 characters")
	}
	if cfg.JobTimeout <= 0 {
		return fmt.Errorf("job timeout must be greater than zero")
	}
	if cfg.JobStdoutLimitBytes <= 0 || cfg.JobStderrLimitBytes <= 0 {
		return fmt.Errorf("job output limits must be greater than zero")
	}
	if cfg.NucleiTemplateRefreshInterval <= 0 {
		return fmt.Errorf("Nuclei template refresh interval must be greater than zero")
	}
	if cfg.NucleiTemplateRefreshInterval < cfg.JobTimeout {
		return fmt.Errorf("Nuclei template refresh interval must not be shorter than the job timeout")
	}
	if cfg.NucleiTemplateMaxStale <= 0 {
		return fmt.Errorf("Nuclei template maximum stale age must be greater than zero")
	}
	if cfg.NucleiTemplateMaxStale < cfg.NucleiTemplateRefreshInterval {
		return fmt.Errorf("Nuclei template maximum stale age must not be shorter than the refresh interval")
	}

	return nil
}
