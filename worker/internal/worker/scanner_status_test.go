package worker

import (
	"testing"
	"time"
)

func TestNucleiScannerStatusRequestMapsVersionsAndTimestamps(t *testing.T) {
	lastAttempt := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	lastSuccess := lastAttempt.Add(time.Second)
	lastValidated := lastSuccess.Add(time.Second)

	request := nucleiScannerStatusRequest(nucleiScannerStatus{
		EngineVersion:       "v3.11.0",
		TemplateVersion:     "v10.4.6",
		TemplateSource:      nucleiTemplateSource,
		LastUpdateAttemptAt: lastAttempt,
		LastUpdateSuccessAt: lastSuccess,
		LastValidatedAt:     lastValidated,
		State:               nucleiScannerStateReady,
		LastError:           "",
	})

	if request.EngineVersion != "v3.11.0" || request.TemplateVersion != "v10.4.6" {
		t.Fatalf("version request = %#v", request)
	}
	if request.GetLastUpdateAttemptAt() != lastAttempt.Format(time.RFC3339Nano) {
		t.Fatalf("last update attempt = %q", request.GetLastUpdateAttemptAt())
	}
	if request.GetLastUpdateSuccessAt() != lastSuccess.Format(time.RFC3339Nano) {
		t.Fatalf("last update success = %q", request.GetLastUpdateSuccessAt())
	}
	if request.GetLastValidatedAt() != lastValidated.Format(time.RFC3339Nano) {
		t.Fatalf("last validation = %q", request.GetLastValidatedAt())
	}
	if request.LastError != nil {
		t.Fatalf("last error = %q, want omitted", request.GetLastError())
	}
}
