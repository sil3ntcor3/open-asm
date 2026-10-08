package worker

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

func TestRunNucleiScannerStatusReportLoopReportsUntilCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	want := nucleiScannerStatus{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.7",
		TemplateSource:  nucleiTemplateSource,
		State:           nucleiScannerStateReady,
	}
	reports := make(chan nucleiScannerStatus, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runNucleiScannerStatusReportLoop(
			ctx,
			5*time.Millisecond,
			func() nucleiScannerStatus { return want },
			func(_ context.Context, status nucleiScannerStatus) error {
				reports <- status
				return nil
			},
			func(reportErr error) {
				t.Errorf("scanner status report loop error = %v", reportErr)
			},
		)
	}()

	select {
	case got := <-reports:
		if got != want {
			t.Fatalf("scanner status report = %#v, want %#v", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("scanner status report loop did not run")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("scanner status report loop did not stop")
	}
}

func TestLoadNucleiScannerStatusPreservesPersistedHealth(t *testing.T) {
	toolPath := t.TempDir()
	lastAttempt := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	lastSuccess := lastAttempt.Add(time.Minute)
	lastValidated := lastSuccess.Add(time.Minute)
	if err := saveNucleiTemplateState(toolPath, nucleiTemplateState{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.7",
		TemplateSource:  nucleiTemplateSource,
		LastAttemptAt:   lastAttempt,
		LastSuccessAt:   lastSuccess,
		LastValidatedAt: lastValidated,
	}); err != nil {
		t.Fatal(err)
	}

	got := loadNucleiScannerStatus(toolPath)
	want := nucleiScannerStatus{
		EngineVersion:       "v3.11.0",
		TemplateVersion:     "v10.4.7",
		TemplateSource:      nucleiTemplateSource,
		LastUpdateAttemptAt: lastAttempt,
		LastUpdateSuccessAt: lastSuccess,
		LastValidatedAt:     lastValidated,
		State:               nucleiScannerStateReady,
	}
	if got != want {
		t.Fatalf("loaded scanner status = %#v, want %#v", got, want)
	}
}

func TestLoadNucleiScannerStatusReconstructsPersistedFailureSeverity(t *testing.T) {
	validatedAt := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name            string
		lastValidatedAt time.Time
		want            nucleiScannerState
	}{
		{name: "never validated", want: nucleiScannerStateError},
		{name: "previously validated", lastValidatedAt: validatedAt, want: nucleiScannerStateStale},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			toolPath := t.TempDir()
			if err := saveNucleiTemplateState(toolPath, nucleiTemplateState{
				TemplateSource:  nucleiTemplateSource,
				LastValidatedAt: test.lastValidatedAt,
				LastError:       "scanner initialization failed",
			}); err != nil {
				t.Fatal(err)
			}

			got := loadNucleiScannerStatus(toolPath)
			if got.State != test.want {
				t.Fatalf("scanner state = %q, want %q", got.State, test.want)
			}
			if !strings.Contains(got.LastError, "initialization failed") {
				t.Fatalf("last error = %q, want persisted failure", got.LastError)
			}
		})
	}
}

func TestNucleiScannerStatusLoaderPreservesLastHealthOnReadFailure(t *testing.T) {
	toolPath := t.TempDir()
	validatedAt := time.Date(2026, time.August, 21, 12, 0, 0, 0, time.UTC)
	if err := saveNucleiTemplateState(toolPath, nucleiTemplateState{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.7",
		TemplateSource:  nucleiTemplateSource,
		LastValidatedAt: validatedAt,
	}); err != nil {
		t.Fatal(err)
	}

	loadStatus := newNucleiScannerStatusLoader(toolPath, nucleiScannerStatus{})
	first := loadStatus()
	if first.State != nucleiScannerStateReady {
		t.Fatalf("initial scanner state = %q, want ready", first.State)
	}
	if err := os.Remove(filepath.Join(toolPath, nucleiTemplateStateFile)); err != nil {
		t.Fatal(err)
	}

	got := loadStatus()
	if got.EngineVersion != first.EngineVersion ||
		got.TemplateVersion != first.TemplateVersion ||
		got.LastValidatedAt != first.LastValidatedAt {
		t.Fatalf("scanner status after read failure = %#v, want prior metadata %#v", got, first)
	}
	if got.State != nucleiScannerStateStale {
		t.Fatalf("scanner state after read failure = %q, want stale", got.State)
	}
	if !strings.Contains(got.LastError, "load persisted Nuclei scanner state") {
		t.Fatalf("last error = %q, want state read failure", got.LastError)
	}
}
