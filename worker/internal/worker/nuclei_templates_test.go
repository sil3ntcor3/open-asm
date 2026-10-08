package worker

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestEnsureNucleiTemplatesBootstrapsIntoToolCache(t *testing.T) {
	toolPath := t.TempDir()
	nucleiPath := filepath.Join(toolPath, nucleiExecutableName())
	if err := os.WriteFile(nucleiPath, []byte("test binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	var commandName string
	var commandArgs []string
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		commandName = name
		commandArgs = append([]string(nil), args...)
		if slices.Contains(args, "-ut") {
			updateDir := argumentValue(t, args, "-ud")
			if err := os.MkdirAll(filepath.Join(updateDir, "http"), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(updateDir, "http", "test.yaml"), []byte("id: test"), 0o644); err != nil {
				t.Fatal(err)
			}
			return []byte("templates installed"), nil
		}
		if slices.Contains(args, "-validate") {
			return []byte("templates valid"), nil
		}
		if slices.Contains(args, "-tv") {
			return []byte("Public nuclei-templates version: v10.4.6"), nil
		}
		return nil, errors.New("unexpected nuclei command")
	}

	if err := ensureNucleiTemplates(context.Background(), toolPath, run); err != nil {
		t.Fatalf("ensureNucleiTemplates() error = %v", err)
	}

	if commandName != nucleiPath {
		t.Fatalf("command name = %q, want %q", commandName, nucleiPath)
	}
	if !slices.Contains(commandArgs, "-validate") || !slices.Contains(commandArgs, "-silent") {
		t.Fatalf("last command args = %q, want fixed template validation flags", commandArgs)
	}
	if argumentValue(t, commandArgs, "-ud") != argumentValue(t, commandArgs, "-t") {
		t.Fatalf("validation args = %q, want the validated set anchored as the template directory", commandArgs)
	}
	activeTemplatePath, err := resolveActiveNucleiTemplatePath(toolPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := argumentValue(t, commandArgs, "-t"); got != activeTemplatePath {
		t.Fatalf("validated directory = %q, want %q", got, activeTemplatePath)
	}
	if ok, err := hasNucleiTemplates(activeTemplatePath); err != nil || !ok {
		t.Fatalf("persistent template set ready = %v, error = %v", ok, err)
	}
	if _, err := os.Stat(filepath.Join(activeTemplatePath, nucleiTemplatesReadyFile)); err != nil {
		t.Fatalf("active template set is not marked ready: %v", err)
	}
	assertNoNucleiStagingDirectories(t, toolPath)
}

func TestPrepareNucleiTemplatesDoesNotAutoUpdateExistingTemplates(t *testing.T) {
	toolPath := t.TempDir()
	now := time.Date(2026, time.August, 18, 12, 0, 0, 0, time.UTC)
	prepareExistingNucleiInstallation(t, toolPath)
	writeTestNucleiTemplateState(t, toolPath, nucleiTemplateState{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.5",
		TemplateSource:  nucleiTemplateSource,
		LastSuccessAt:   now.Add(-30 * 24 * time.Hour),
	})
	updateCalled := false
	remoteVersionRead := false
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		switch {
		case slices.Contains(args, "-ut"):
			updateCalled = true
			return nil, errors.New("automatic updates are forbidden")
		case slices.Contains(args, "-version"):
			return []byte("Nuclei Engine Version: v3.11.0"), nil
		case slices.Contains(args, "-tv"):
			remoteVersionRead = true
			return []byte("Public nuclei-templates version: v10.4.7"), nil
		default:
			return []byte("templates valid"), nil
		}
	}

	status, err := prepareNucleiTemplates(context.Background(), toolPath, now, run)
	if err != nil {
		t.Fatalf("prepareNucleiTemplates() error = %v", err)
	}
	if updateCalled {
		t.Fatal("existing templates were updated without an administrator request")
	}
	if remoteVersionRead {
		t.Fatal("existing installed version was replaced with the remote public version")
	}
	if status.TemplateVersion != "v10.4.5" || status.State != nucleiScannerStateReady {
		t.Fatalf("status = %#v, want existing ready template version", status)
	}
}

func TestReconcileNucleiTemplatesSkipsRefreshWhenStateIsFresh(t *testing.T) {
	toolPath := t.TempDir()
	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	nucleiPath := filepath.Join(toolPath, nucleiExecutableName())
	if err := os.WriteFile(nucleiPath, []byte("test binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	templatePath := filepath.Join(toolPath, nucleiTemplatesDirectory, "http", "existing.yaml")
	if err := os.MkdirAll(filepath.Dir(templatePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(templatePath, []byte("id: existing"), 0o644); err != nil {
		t.Fatal(err)
	}
	writeTestNucleiTemplateState(t, toolPath, nucleiTemplateState{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.6",
		LastSuccessAt:   now.Add(-time.Hour),
	})

	updateCalled := false
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if slices.Contains(args, "-ut") {
			updateCalled = true
		}
		if slices.Contains(args, "-version") {
			return []byte("Nuclei Engine Version: v3.11.0"), nil
		}
		return []byte("templates valid"), nil
	}

	status, err := reconcileNucleiTemplates(
		context.Background(),
		toolPath,
		nucleiTemplateRefreshOptions{
			refreshInterval: 6 * time.Hour,
			maxStale:        24 * time.Hour,
			now:             func() time.Time { return now },
		},
		run,
	)
	if err != nil {
		t.Fatalf("reconcileNucleiTemplates() error = %v", err)
	}
	if updateCalled {
		t.Fatal("template refresh ran for a fresh validated template set")
	}
	if status.State != nucleiScannerStateReady {
		t.Fatalf("scanner state = %q, want %q", status.State, nucleiScannerStateReady)
	}
}

func TestReconcileNucleiTemplatesRefreshesStaleTemplates(t *testing.T) {
	toolPath := t.TempDir()
	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	prepareExistingNucleiInstallation(t, toolPath)
	writeTestNucleiTemplateState(t, toolPath, nucleiTemplateState{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.5",
		LastSuccessAt:   now.Add(-7 * time.Hour),
	})

	updateCalled := false
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		switch {
		case slices.Contains(args, "-version"):
			return []byte("Nuclei Engine Version: v3.11.0"), nil
		case slices.Contains(args, "-ut"):
			updateCalled = true
			writeDownloadedTemplate(t, argumentValue(t, args, "-ud"), "refreshed")
			return []byte("Successfully updated nuclei-templates to v10.4.6"), nil
		case slices.Contains(args, "-tv"):
			return []byte("Public nuclei-templates version: v10.4.6"), nil
		default:
			return []byte("templates valid"), nil
		}
	}

	status, err := reconcileNucleiTemplates(
		context.Background(),
		toolPath,
		nucleiTemplateRefreshOptions{
			refreshInterval: 6 * time.Hour,
			maxStale:        24 * time.Hour,
			now:             func() time.Time { return now },
		},
		run,
	)
	if err != nil {
		t.Fatalf("reconcileNucleiTemplates() error = %v", err)
	}
	if !updateCalled {
		t.Fatal("stale templates were not refreshed")
	}
	if status.TemplateVersion != "v10.4.6" || status.State != nucleiScannerStateReady {
		t.Fatalf("scanner status = %#v, want refreshed ready status", status)
	}
	if !status.LastUpdateSuccessAt.Equal(now) {
		t.Fatalf("last update success = %s, want %s", status.LastUpdateSuccessAt, now)
	}
}

func TestReconcileNucleiTemplatesForcesRefreshAfterEngineChange(t *testing.T) {
	toolPath := t.TempDir()
	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	prepareExistingNucleiInstallation(t, toolPath)
	writeTestNucleiTemplateState(t, toolPath, nucleiTemplateState{
		EngineVersion:   "v3.8.0",
		TemplateVersion: "v10.4.6",
		LastSuccessAt:   now.Add(-time.Hour),
	})

	updateCalled := false
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		switch {
		case slices.Contains(args, "-version"):
			return []byte("Nuclei Engine Version: v3.11.0"), nil
		case slices.Contains(args, "-ut"):
			updateCalled = true
			writeDownloadedTemplate(t, argumentValue(t, args, "-ud"), "engine-compatible")
			return []byte("updated"), nil
		case slices.Contains(args, "-tv"):
			return []byte("Public nuclei-templates version: v10.4.6"), nil
		default:
			return []byte("templates valid"), nil
		}
	}

	status, err := reconcileNucleiTemplates(
		context.Background(),
		toolPath,
		nucleiTemplateRefreshOptions{
			refreshInterval: 6 * time.Hour,
			maxStale:        24 * time.Hour,
			now:             func() time.Time { return now },
		},
		run,
	)
	if err != nil {
		t.Fatalf("reconcileNucleiTemplates() error = %v", err)
	}
	if !updateCalled {
		t.Fatal("templates were not refreshed after the Nuclei engine changed")
	}
	if status.EngineVersion != "v3.11.0" {
		t.Fatalf("engine version = %q, want v3.11.0", status.EngineVersion)
	}
}

func TestReconcileNucleiTemplatesKeepsLastKnownGoodOnRefreshFailure(t *testing.T) {
	toolPath := t.TempDir()
	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	prepareExistingNucleiInstallation(t, toolPath)
	writeTestNucleiTemplateState(t, toolPath, nucleiTemplateState{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.5",
		LastSuccessAt:   now.Add(-7 * time.Hour),
	})

	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if slices.Contains(args, "-version") {
			return []byte("Nuclei Engine Version: v3.11.0"), nil
		}
		if slices.Contains(args, "-ut") {
			return []byte("upstream unavailable"), errors.New("exit status 1")
		}
		return []byte("templates valid"), nil
	}

	status, err := reconcileNucleiTemplates(
		context.Background(),
		toolPath,
		nucleiTemplateRefreshOptions{
			refreshInterval: 6 * time.Hour,
			maxStale:        24 * time.Hour,
			now:             func() time.Time { return now },
		},
		run,
	)
	if err != nil {
		t.Fatalf("refresh failure with valid templates should be non-fatal: %v", err)
	}
	if status.State != nucleiScannerStateStale || !strings.Contains(status.LastError, "upstream unavailable") {
		t.Fatalf("scanner status = %#v, want stale status with update error", status)
	}
	contents, readErr := os.ReadFile(filepath.Join(toolPath, nucleiTemplatesDirectory, "http", "existing.yaml"))
	if readErr != nil || string(contents) != "id: existing" {
		t.Fatalf("last-known-good templates changed after failed refresh: %q, %v", contents, readErr)
	}
}

func TestReconcileNucleiTemplatesRestoresLastKnownGoodAfterActivationValidationFailure(t *testing.T) {
	toolPath := t.TempDir()
	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	prepareExistingNucleiInstallation(t, toolPath)
	writeTestNucleiTemplateState(t, toolPath, nucleiTemplateState{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.5",
		LastSuccessAt:   now.Add(-7 * time.Hour),
	})

	validationCalls := 0
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		switch {
		case slices.Contains(args, "-version"):
			return []byte("Nuclei Engine Version: v3.11.0"), nil
		case slices.Contains(args, "-ut"):
			writeDownloadedTemplate(t, argumentValue(t, args, "-ud"), "refreshed")
			return []byte("updated"), nil
		case slices.Contains(args, "-tv"):
			return []byte("Public nuclei-templates version: v10.4.6"), nil
		case slices.Contains(args, "-validate"):
			validationCalls++
			if validationCalls == 3 {
				return []byte("active validation failed"), errors.New("exit status 1")
			}
			return []byte("templates valid"), nil
		default:
			return nil, errors.New("unexpected nuclei command")
		}
	}

	status, err := reconcileNucleiTemplates(
		context.Background(),
		toolPath,
		nucleiTemplateRefreshOptions{
			refreshInterval: 6 * time.Hour,
			maxStale:        24 * time.Hour,
			now:             func() time.Time { return now },
		},
		run,
	)
	if err != nil {
		t.Fatalf("failed activation with a recoverable template set should be non-fatal: %v", err)
	}
	if status.State != nucleiScannerStateStale {
		t.Fatalf("scanner state = %q, want %q", status.State, nucleiScannerStateStale)
	}
	existingPath := filepath.Join(toolPath, nucleiTemplatesDirectory, "http", "existing.yaml")
	contents, readErr := os.ReadFile(existingPath)
	if readErr != nil || string(contents) != "id: existing" {
		t.Fatalf("last-known-good templates were not restored: %q, %v", contents, readErr)
	}
	refreshedPath := filepath.Join(toolPath, nucleiTemplatesDirectory, "http", "refreshed.yaml")
	if _, statErr := os.Stat(refreshedPath); !os.IsNotExist(statErr) {
		t.Fatalf("failed activated template remains at %s: %v", refreshedPath, statErr)
	}
}

func TestRunNucleiTemplateRefreshLoopChecksUntilCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	results := make(chan nucleiScannerStatus, 2)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runNucleiTemplateRefreshLoop(
			ctx,
			5*time.Millisecond,
			func(context.Context) (nucleiScannerStatus, error) {
				return nucleiScannerStatus{State: nucleiScannerStateReady}, nil
			},
			func(status nucleiScannerStatus, err error) {
				if err != nil {
					t.Errorf("refresh loop result error = %v", err)
				}
				results <- status
			},
		)
	}()

	select {
	case status := <-results:
		if status.State != nucleiScannerStateReady {
			t.Fatalf("scanner state = %q, want ready", status.State)
		}
	case <-time.After(time.Second):
		t.Fatal("refresh loop did not run")
	}

	cancel()
	waitForTestSignal(t, done, "Nuclei template refresh loop shutdown")
}

func TestNucleiStatusForWrapperFailureReportsErrorWithoutValidatedTemplates(t *testing.T) {
	toolPath := t.TempDir()
	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	status := nucleiStatusForWrapperFailure(
		toolPath,
		nucleiTemplateRefreshOptions{
			maxStale: 24 * time.Hour,
			now:      func() time.Time { return now },
		},
		errors.New("download tools: connection unavailable"),
	)

	if status.State != nucleiScannerStateError {
		t.Fatalf("scanner state = %q, want %q", status.State, nucleiScannerStateError)
	}
	if !strings.Contains(status.LastError, "download tools") {
		t.Fatalf("last error = %q, want tool download failure", status.LastError)
	}
	if status.TemplateSource != nucleiTemplateSource {
		t.Fatalf("template source = %q, want %q", status.TemplateSource, nucleiTemplateSource)
	}
}

func TestNucleiStatusForWrapperFailureReportsStaleWithLastKnownGood(t *testing.T) {
	toolPath := t.TempDir()
	now := time.Date(2026, time.July, 20, 12, 0, 0, 0, time.UTC)
	writeTestNucleiTemplateState(t, toolPath, nucleiTemplateState{
		EngineVersion:   "v3.11.0",
		TemplateVersion: "v10.4.6",
		LastSuccessAt:   now.Add(-time.Hour),
		LastValidatedAt: now.Add(-time.Hour),
	})
	status := nucleiStatusForWrapperFailure(
		toolPath,
		nucleiTemplateRefreshOptions{
			maxStale: 24 * time.Hour,
			now:      func() time.Time { return now },
		},
		errors.New("acquire tool cache lock: deadline exceeded"),
	)

	if status.State != nucleiScannerStateStale {
		t.Fatalf("scanner state = %q, want %q", status.State, nucleiScannerStateStale)
	}
	if status.EngineVersion != "v3.11.0" || status.TemplateVersion != "v10.4.6" {
		t.Fatalf("scanner status lost last-known-good versions: %#v", status)
	}
}

func TestEnsureNucleiTemplatesRejectsFailedBootstrap(t *testing.T) {
	toolPath := t.TempDir()
	nucleiPath := filepath.Join(toolPath, nucleiExecutableName())
	if err := os.WriteFile(nucleiPath, []byte("test binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte("network unavailable"), errors.New("exit status 1")
	}

	err := ensureNucleiTemplates(context.Background(), toolPath, run)
	if err == nil || !strings.Contains(err.Error(), "network unavailable") {
		t.Fatalf("error = %v, want bootstrap output", err)
	}
	if ok, checkErr := hasNucleiTemplates(filepath.Join(toolPath, nucleiTemplatesDirectory)); checkErr != nil || ok {
		t.Fatalf("persistent template set ready = %v, error = %v; want not ready", ok, checkErr)
	}
	assertNoNucleiStagingDirectories(t, toolPath)
}

func TestEnsureNucleiTemplatesRejectsEmptyBootstrap(t *testing.T) {
	toolPath := t.TempDir()
	nucleiPath := filepath.Join(toolPath, nucleiExecutableName())
	if err := os.WriteFile(nucleiPath, []byte("test binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		updateDir := argumentValue(t, args, "-ud")
		if err := os.MkdirAll(updateDir, 0o755); err != nil {
			t.Fatal(err)
		}
		return []byte("update completed"), nil
	}

	err := ensureNucleiTemplates(context.Background(), toolPath, run)
	if err == nil || !strings.Contains(err.Error(), "no YAML templates") {
		t.Fatalf("error = %v, want empty template set error", err)
	}
	assertNoNucleiStagingDirectories(t, toolPath)
}

func TestEnsureNucleiTemplatesReplacesInvalidExistingDirectory(t *testing.T) {
	toolPath := t.TempDir()
	nucleiPath := filepath.Join(toolPath, nucleiExecutableName())
	if err := os.WriteFile(nucleiPath, []byte("test binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	templatePath := filepath.Join(toolPath, nucleiTemplatesDirectory)
	if err := os.MkdirAll(templatePath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(templatePath, "legacy.txt"), []byte("incomplete"), 0o644); err != nil {
		t.Fatal(err)
	}

	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if slices.Contains(args, "-ut") {
			updateDir := argumentValue(t, args, "-ud")
			if err := os.WriteFile(filepath.Join(updateDir, "valid.yaml"), []byte("id: valid"), 0o644); err != nil {
				t.Fatal(err)
			}
			return nil, nil
		}
		if slices.Contains(args, "-tv") {
			return []byte("Public nuclei-templates version: v10.4.6"), nil
		}
		return nil, nil
	}

	if err := ensureNucleiTemplates(context.Background(), toolPath, run); err != nil {
		t.Fatalf("ensureNucleiTemplates() error = %v", err)
	}
	activeTemplatePath, err := resolveActiveNucleiTemplatePath(toolPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(activeTemplatePath, "valid.yaml")); err != nil {
		t.Fatalf("activated template missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(templatePath, "legacy.txt")); err != nil {
		t.Fatalf("legacy fallback directory should remain available: %v", err)
	}
}

func TestResolveActiveNucleiTemplatePathUsesPublishedPointer(t *testing.T) {
	toolPath := t.TempDir()
	candidatePath := filepath.Join(toolPath, nucleiTemplatesVersionPrefix+"10.4.6-test")
	if err := os.MkdirAll(candidatePath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(candidatePath, nucleiTemplatesReadyFile), []byte("v10.4.6\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := publishNucleiTemplatesPointer(toolPath, candidatePath); err != nil {
		t.Fatal(err)
	}

	got, err := resolveActiveNucleiTemplatePath(toolPath)
	if err != nil {
		t.Fatal(err)
	}
	if got != candidatePath {
		t.Fatalf("active template path = %q, want %q", got, candidatePath)
	}
}

func TestResolveActiveNucleiTemplatePathRecoversNewestReadyDirectory(t *testing.T) {
	toolPath := t.TempDir()
	olderPath := writeReadyNucleiTemplateDirectory(t, toolPath, "10.4.5-old")
	olderTime := time.Date(2026, time.July, 20, 10, 0, 0, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(olderPath, nucleiTemplatesReadyFile), olderTime, olderTime); err != nil {
		t.Fatal(err)
	}
	newerPath := writeReadyNucleiTemplateDirectory(t, toolPath, "10.4.6-new")
	newerTime := olderTime.Add(time.Hour)
	if err := os.Chtimes(filepath.Join(newerPath, nucleiTemplatesReadyFile), newerTime, newerTime); err != nil {
		t.Fatal(err)
	}

	got, err := resolveActiveNucleiTemplatePath(toolPath)
	if err != nil {
		t.Fatal(err)
	}
	if got != newerPath {
		t.Fatalf("recovered template path = %q, want %q", got, newerPath)
	}
}

func TestNucleiAlreadyCurrentRefreshIntegration(t *testing.T) {
	binarySource := os.Getenv("OASM_NUCLEI_INTEGRATION_BINARY")
	if binarySource == "" {
		t.Skip("set OASM_NUCLEI_INTEGRATION_BINARY to run the real Nuclei updater integration test")
	}
	toolPath := t.TempDir()
	t.Setenv("HOME", t.TempDir())
	binary, err := os.ReadFile(binarySource)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(toolPath, nucleiExecutableName()), binary, 0o755); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	options := nucleiTemplateRefreshOptions{
		refreshInterval: time.Hour,
		maxStale:        24 * time.Hour,
		now:             func() time.Time { return now },
	}

	first, err := reconcileNucleiTemplates(context.Background(), toolPath, options, runCommandOutput)
	if err != nil || first.State != nucleiScannerStateReady {
		t.Fatalf("first real refresh status = %#v, error = %v", first, err)
	}
	now = now.Add(2 * time.Hour)
	second, err := reconcileNucleiTemplates(context.Background(), toolPath, options, runCommandOutput)
	if err != nil || second.State != nucleiScannerStateReady {
		t.Fatalf("already-current real refresh status = %#v, error = %v", second, err)
	}
	activePath, err := resolveActiveNucleiTemplatePath(toolPath)
	if err != nil {
		t.Fatal(err)
	}
	if ready, err := hasNucleiTemplates(activePath); err != nil || !ready {
		t.Fatalf("already-current active templates ready = %v, error = %v", ready, err)
	}
}

func TestEnsureNucleiTemplatesRejectsInvalidDownloadedTemplates(t *testing.T) {
	toolPath := t.TempDir()
	nucleiPath := filepath.Join(toolPath, nucleiExecutableName())
	if err := os.WriteFile(nucleiPath, []byte("test binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if slices.Contains(args, "-ut") {
			updateDir := argumentValue(t, args, "-ud")
			if err := os.WriteFile(filepath.Join(updateDir, "invalid.yaml"), nil, 0o644); err != nil {
				t.Fatal(err)
			}
			return nil, nil
		}
		return []byte("template has no id"), errors.New("exit status 1")
	}

	err := ensureNucleiTemplates(context.Background(), toolPath, run)
	if err == nil || !strings.Contains(err.Error(), "template has no id") {
		t.Fatalf("error = %v, want Nuclei validation output", err)
	}
	if _, statErr := os.Stat(filepath.Join(toolPath, nucleiTemplatesDirectory)); !os.IsNotExist(statErr) {
		t.Fatalf("invalid downloaded templates were activated: %v", statErr)
	}
}

func TestWithToolCacheLockSerializesConcurrentActions(t *testing.T) {
	toolPath := t.TempDir()
	firstEntered := make(chan struct{})
	releaseFirst := make(chan struct{})
	secondEntered := make(chan struct{})
	errorsChannel := make(chan error, 2)
	options := toolCacheLockOptions{
		pollInterval: 5 * time.Millisecond,
		staleAfter:   time.Minute,
	}

	go func() {
		errorsChannel <- withToolCacheLock(context.Background(), toolPath, options, func() error {
			close(firstEntered)
			<-releaseFirst
			return nil
		})
	}()
	<-firstEntered

	go func() {
		errorsChannel <- withToolCacheLock(context.Background(), toolPath, options, func() error {
			close(secondEntered)
			return nil
		})
	}()

	select {
	case <-secondEntered:
		t.Fatal("second cache action entered before the first released the lock")
	case <-time.After(30 * time.Millisecond):
	}
	close(releaseFirst)
	<-secondEntered

	for range 2 {
		if err := <-errorsChannel; err != nil {
			t.Fatalf("withToolCacheLock() error = %v", err)
		}
	}
}

func TestWaitForWorkerReadinessRetriesTransientFailure(t *testing.T) {
	var attempts atomic.Int32
	err := waitForWorkerReadiness(
		context.Background(),
		workerReadinessOptions{attemptTimeout: time.Second, retryDelay: time.Millisecond},
		func(_ context.Context) error {
			if attempts.Add(1) == 1 {
				return errors.New("temporary failure")
			}
			return nil
		},
		func(error) {},
	)

	if err != nil {
		t.Fatalf("waitForWorkerReadiness() error = %v", err)
	}
	if got := attempts.Load(); got != 2 {
		t.Fatalf("attempts = %d, want 2", got)
	}
}

func TestWaitForWorkerReadinessBoundsHungAttempt(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	var attempts atomic.Int32

	err := waitForWorkerReadiness(
		ctx,
		workerReadinessOptions{attemptTimeout: 10 * time.Millisecond, retryDelay: time.Millisecond},
		func(attemptCtx context.Context) error {
			attempts.Add(1)
			<-attemptCtx.Done()
			return attemptCtx.Err()
		},
		func(error) {},
	)

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want context deadline exceeded", err)
	}
	if attempts.Load() < 2 {
		t.Fatalf("attempts = %d, want multiple bounded attempts", attempts.Load())
	}
}

func hasArgument(args []string, name string) bool {
	for _, arg := range args {
		if arg == name {
			return true
		}
	}
	return false
}

func argumentValue(t *testing.T, args []string, name string) string {
	t.Helper()
	for index, arg := range args {
		if arg == name && index+1 < len(args) {
			return args[index+1]
		}
	}
	t.Fatalf("argument %q not found in %q", name, args)
	return ""
}

func assertNoNucleiStagingDirectories(t *testing.T, toolPath string) {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(toolPath, nucleiTemplatesStagingPrefix+"*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("staging directories remain after bootstrap: %q", matches)
	}
}

func prepareExistingNucleiInstallation(t *testing.T, toolPath string) {
	t.Helper()

	nucleiPath := filepath.Join(toolPath, nucleiExecutableName())
	if err := os.WriteFile(nucleiPath, []byte("test binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	templatePath := filepath.Join(toolPath, nucleiTemplatesDirectory, "http", "existing.yaml")
	if err := os.MkdirAll(filepath.Dir(templatePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(templatePath, []byte("id: existing"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeDownloadedTemplate(t *testing.T, updateDir string, id string) {
	t.Helper()

	templatePath := filepath.Join(updateDir, "http", id+".yaml")
	if err := os.MkdirAll(filepath.Dir(templatePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(templatePath, []byte("id: "+id), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeTestNucleiTemplateState(t *testing.T, toolPath string, state nucleiTemplateState) {
	t.Helper()

	data, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(toolPath, nucleiTemplateStateFile), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeReadyNucleiTemplateDirectory(t *testing.T, toolPath string, suffix string) string {
	t.Helper()

	candidatePath := filepath.Join(toolPath, nucleiTemplatesVersionPrefix+suffix)
	if err := os.MkdirAll(candidatePath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(candidatePath, nucleiTemplatesReadyFile), []byte("ready\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return candidatePath
}

func writeTestNucleiBinary(t *testing.T, toolPath string) {
	t.Helper()

	if err := os.WriteFile(
		filepath.Join(toolPath, nucleiExecutableName()),
		[]byte("test binary"),
		0o755,
	); err != nil {
		t.Fatal(err)
	}
}

func writeTestNucleiTemplateSeed(t *testing.T, version string) string {
	t.Helper()

	seedPath := t.TempDir()
	templatePath := filepath.Join(seedPath, "http", "seeded.yaml")
	if err := os.MkdirAll(filepath.Dir(templatePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(templatePath, []byte("id: seeded"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(seedPath, nucleiIgnoreFile),
		[]byte("tags:\n  - fuzz\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if version != "" {
		if err := os.WriteFile(
			filepath.Join(seedPath, nucleiTemplateSeedVersionFile),
			[]byte(version+"\n"),
			0o644,
		); err != nil {
			t.Fatal(err)
		}
	}
	return seedPath
}

func TestBootstrapNucleiTemplatesActivatesBakedSeedWithoutUpdating(t *testing.T) {
	toolPath := t.TempDir()
	writeTestNucleiBinary(t, toolPath)
	t.Setenv(nucleiTemplateSeedEnvVar, writeTestNucleiTemplateSeed(t, "10.4.7"))

	var updateAttempts int
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if slices.Contains(args, "-ut") {
			updateAttempts++
			return nil, errors.New("network is unavailable")
		}
		if slices.Contains(args, "-validate") {
			return []byte("templates valid"), nil
		}
		return nil, errors.New("unexpected nuclei command")
	}

	if err := ensureNucleiTemplates(context.Background(), toolPath, run); err != nil {
		t.Fatalf("ensureNucleiTemplates() error = %v", err)
	}

	if updateAttempts != 0 {
		t.Fatalf("template update attempts = %d, want 0 when a baked seed is present", updateAttempts)
	}
	activeTemplatePath, err := resolveActiveNucleiTemplatePath(toolPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(filepath.Base(activeTemplatePath), nucleiTemplatesVersionPrefix+"10.4.7-") {
		t.Fatalf("active template directory = %q, want the seeded version", activeTemplatePath)
	}
	if _, err := os.Stat(filepath.Join(activeTemplatePath, "http", "seeded.yaml")); err != nil {
		t.Fatalf("seeded template was not activated: %v", err)
	}
	readyVersion, err := os.ReadFile(filepath.Join(activeTemplatePath, nucleiTemplatesReadyFile))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(readyVersion)) != "10.4.7" {
		t.Fatalf("ready marker = %q, want 10.4.7", strings.TrimSpace(string(readyVersion)))
	}
	assertNoNucleiStagingDirectories(t, toolPath)
}

func TestBootstrapNucleiTemplatesInstallsSeededIgnoreList(t *testing.T) {
	toolPath := t.TempDir()
	configDirectory := filepath.Join(t.TempDir(), "nuclei-config")
	writeTestNucleiBinary(t, toolPath)
	t.Setenv(nucleiTemplateSeedEnvVar, writeTestNucleiTemplateSeed(t, "10.4.7"))
	t.Setenv(nucleiConfigDirEnvVar, configDirectory)

	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if slices.Contains(args, "-validate") {
			return []byte("templates valid"), nil
		}
		return nil, errors.New("unexpected nuclei command")
	}

	if err := ensureNucleiTemplates(context.Background(), toolPath, run); err != nil {
		t.Fatalf("ensureNucleiTemplates() error = %v", err)
	}

	// `nuclei -ut` installs the release ignore list; a seeded worker must end
	// up with the same exclusions rather than running ignored templates.
	installed, err := os.ReadFile(filepath.Join(configDirectory, nucleiIgnoreFile))
	if err != nil {
		t.Fatalf("seeded ignore list was not installed: %v", err)
	}
	if !strings.Contains(string(installed), "fuzz") {
		t.Fatalf("installed ignore list = %q, want the seeded exclusions", string(installed))
	}
}

func TestBootstrapNucleiTemplatesFallsBackWhenSeedIsUnusable(t *testing.T) {
	for _, testCase := range []struct {
		name          string
		seedVersion   string
		seedPathValue func(t *testing.T) string
	}{
		{
			name:          "no seed baked into the image",
			seedPathValue: func(*testing.T) string { return "" },
		},
		{
			name: "seed directory is missing",
			seedPathValue: func(t *testing.T) string {
				return filepath.Join(t.TempDir(), "absent")
			},
		},
		{
			name: "seed version marker is malformed",
			seedPathValue: func(t *testing.T) string {
				return writeTestNucleiTemplateSeed(t, "not-a-version")
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			toolPath := t.TempDir()
			writeTestNucleiBinary(t, toolPath)
			t.Setenv(nucleiTemplateSeedEnvVar, testCase.seedPathValue(t))

			var updateAttempts int
			run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
				if slices.Contains(args, "-ut") {
					updateAttempts++
					writeDownloadedTemplate(t, argumentValue(t, args, "-ud"), "downloaded")
					return []byte("templates installed"), nil
				}
				if slices.Contains(args, "-validate") {
					return []byte("templates valid"), nil
				}
				if slices.Contains(args, "-tv") {
					return []byte("Public nuclei-templates version: v10.4.6"), nil
				}
				return nil, errors.New("unexpected nuclei command")
			}

			if err := ensureNucleiTemplates(context.Background(), toolPath, run); err != nil {
				t.Fatalf("ensureNucleiTemplates() error = %v", err)
			}

			if updateAttempts != 1 {
				t.Fatalf("template update attempts = %d, want 1 when no usable seed exists", updateAttempts)
			}
			activeTemplatePath, err := resolveActiveNucleiTemplatePath(toolPath)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(activeTemplatePath, "http", "downloaded.yaml")); err != nil {
				t.Fatalf("updated template set was not activated: %v", err)
			}
		})
	}
}

func TestBootstrapNucleiTemplatesDiscardsSeedThatFailsValidation(t *testing.T) {
	toolPath := t.TempDir()
	writeTestNucleiBinary(t, toolPath)
	t.Setenv(nucleiTemplateSeedEnvVar, writeTestNucleiTemplateSeed(t, "10.4.7"))

	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if slices.Contains(args, "-ut") {
			writeDownloadedTemplate(t, argumentValue(t, args, "-ud"), "downloaded")
			return []byte("templates installed"), nil
		}
		if slices.Contains(args, "-validate") {
			validatedPath := argumentValue(t, args, "-t")
			if _, err := os.Stat(filepath.Join(validatedPath, "http", "seeded.yaml")); err == nil {
				return nil, errors.New("seeded template set is corrupt")
			}
			return []byte("templates valid"), nil
		}
		if slices.Contains(args, "-tv") {
			return []byte("Public nuclei-templates version: v10.4.6"), nil
		}
		return nil, errors.New("unexpected nuclei command")
	}

	if err := ensureNucleiTemplates(context.Background(), toolPath, run); err != nil {
		t.Fatalf("ensureNucleiTemplates() error = %v", err)
	}

	activeTemplatePath, err := resolveActiveNucleiTemplatePath(toolPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(activeTemplatePath, "http", "seeded.yaml")); err == nil {
		t.Fatal("invalid seeded template set was activated")
	}
	if _, err := os.Stat(filepath.Join(activeTemplatePath, "http", "downloaded.yaml")); err != nil {
		t.Fatalf("updated template set was not activated after the seed was rejected: %v", err)
	}
	entries, err := os.ReadDir(toolPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), nucleiTemplatesVersionPrefix+"10.4.7-") {
			t.Fatalf("rejected seed directory was left behind: %q", entry.Name())
		}
	}
}
