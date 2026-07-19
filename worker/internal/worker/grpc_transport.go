package worker

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"

	"oasm-worker/internal/config"

	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

func newGRPCTransportCredentials(cfg *config.Config) (credentials.TransportCredentials, error) {
	if !cfg.GrpcTLSEnabled {
		return insecure.NewCredentials(), nil
	}

	if cfg.GrpcCAFile == "" || cfg.GrpcCertFile == "" || cfg.GrpcKeyFile == "" {
		return nil, fmt.Errorf("WORKER_GRPC_TLS_ENABLED requires CA, certificate, and key files")
	}

	caPEM, err := os.ReadFile(cfg.GrpcCAFile)
	if err != nil {
		return nil, fmt.Errorf("read gRPC CA certificate: %w", err)
	}
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caPEM) {
		return nil, fmt.Errorf("gRPC CA file contains no valid certificates")
	}

	certificate, err := tls.LoadX509KeyPair(cfg.GrpcCertFile, cfg.GrpcKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load gRPC client certificate: %w", err)
	}

	return credentials.NewTLS(&tls.Config{
		Certificates: []tls.Certificate{certificate},
		RootCAs:      caPool,
		MinVersion:   tls.VersionTLS12,
		ServerName:   cfg.GrpcServerName,
	}), nil
}
