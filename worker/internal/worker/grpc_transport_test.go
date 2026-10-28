package worker

import (
	"testing"

	"oasm-worker/internal/config"
)

func TestNewGRPCTransportCredentialsRejectsMissingMTLSFiles(t *testing.T) {
	_, err := newGRPCTransportCredentials(&config.Config{
		GrpcTLSEnabled: true,
	})

	if err == nil {
		t.Fatal("mTLS configuration without certificate files was accepted")
	}
}
