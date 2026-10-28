package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/oasm-platform/oasm-sdk-go/oasm"
)

const (
	nucleiTemplatesDirectory      = "nuclei-templates"
	nucleiTemplatesStagingPrefix  = ".nuclei-templates-stage-"
	nucleiTemplatesUpdaterDir     = ".nuclei-templates-updater"
	nucleiTemplatesVersionPrefix  = "nuclei-templates-v"
	nucleiTemplatesPointerFile    = ".nuclei-templates-current"
	nucleiTemplatesReadyFile      = ".oasm-ready"
	nucleiTemplateStateFile       = ".nuclei-templates-state.json"
	nucleiTemplateSource          = "projectdiscovery/nuclei-templates"
	nucleiTemplateSeedVersionFile = ".oasm-seed-version"
	nucleiTemplateSeedEnvVar      = "WORKER_NUCLEI_TEMPLATE_SEED"
	nucleiIgnoreFile              = ".nuclei-ignore"
	nucleiConfigDirEnvVar         = "NUCLEI_CONFIG_DIR"
	maxBootstrapErrorOutputBytes  = 4096
	maxNucleiStatusErrorBytes     = 2048
)

var errNucleiTemplateFound = errors.New("nuclei template found")

// errNucleiTemplateSeedUnavailable separates "this worker image ships no seed"
// from "the seed is present but broken": the first is the normal case for
// locally built workers and falls through to the updater without noise.
var errNucleiTemplateSeedUnavailable = errors.New("no baked nuclei template seed is available")

var templateLog = oasm.NewLogger("Worker.Templates")

var (
	nucleiEngineVersionPattern   = regexp.MustCompile(`(?i)Nuclei Engine Version:\s*(v?[0-9]+\.[0-9]+\.[0-9]+)`)
	nucleiTemplateVersionPattern = regexp.MustCompile(`(?i)Public nuclei-templates version:\s*(v?[0-9]+\.[0-9]+\.[0-9]+)`)
)

type nucleiScannerState string

const (
	nucleiScannerStateReady nucleiScannerState = "ready"
	nucleiScannerStateStale nucleiScannerState = "stale"
	nucleiScannerStateError nucleiScannerState = "error"
)

type nucleiTemplateRefreshOptions struct {
	refreshInterval time.Duration
	maxStale        time.Duration
	now             func() time.Time
}

type nucleiTemplateState struct {
	EngineVersion   string    `json:"engineVersion"`
	TemplateVersion string    `json:"templateVersion"`
	TemplateSource  string    `json:"templateSource"`
	LastAttemptAt   time.Time `json:"lastAttemptAt"`
	LastSuccessAt   time.Time `json:"lastSuccessAt"`
	LastValidatedAt time.Time `json:"lastValidatedAt"`
	LastError       string    `json:"lastError,omitempty"`
}

type nucleiScannerStatus struct {
	EngineVersion       string
	TemplateVersion     string
	TemplateSource      string
	LastUpdateAttemptAt time.Time
	LastUpdateSuccessAt time.Time
	LastValidatedAt     time.Time
	State               nucleiScannerState
	LastError           string
}

type commandOutputRunner func(
	ctx context.Context,
	name string,
	args ...string,
) ([]byte, error)

// prepareNucleiTemplates validates the active template set and bootstraps it
// only when none is usable. Existing templates are never refreshed here;
// release updates require an administrator-approved update directive.
func prepareNucleiTemplates(
	ctx context.Context,
	toolPath string,
	now time.Time,
	run commandOutputRunner,
) (nucleiScannerStatus, error) {
	absToolPath, nucleiPath, templatePath, err := nucleiInstallationPaths(toolPath)
	if err != nil {
		return nucleiScannerStatus{State: nucleiScannerStateError, LastError: boundedNucleiStatusError(err)}, err
	}
	state, _ := loadNucleiTemplateState(absToolPath)
	state.TemplateSource = nucleiTemplateSource
	engineVersion, err := readNucleiEngineVersion(ctx, nucleiPath, run)
	if err != nil {
		return handleNucleiRefreshFailure(absToolPath, state, false, err)
	}
	state.EngineVersion = engineVersion

	ready, validationErr := validateNucleiTemplates(ctx, nucleiPath, templatePath, run)
	if validationErr != nil || !ready {
		state.LastAttemptAt = now
		templateVersion, updateErr := bootstrapNucleiTemplates(
			ctx,
			absToolPath,
			nucleiPath,
			templatePath,
			run,
		)
		if updateErr != nil {
			return handleNucleiRefreshFailure(absToolPath, state, false, updateErr)
		}
		state.TemplateVersion = templateVersion
		state.LastSuccessAt = now
	} else {
		templateVersion := installedNucleiTemplateVersion(templatePath, state)
		if templateVersion == "" {
			var versionErr error
			templateVersion, versionErr = readNucleiTemplateVersion(ctx, nucleiPath, run)
			if versionErr != nil {
				return handleNucleiRefreshFailure(absToolPath, state, true, versionErr)
			}
		}
		state.TemplateVersion = templateVersion
	}

	state.LastValidatedAt = now
	state.LastError = ""
	if err := saveNucleiTemplateState(absToolPath, state); err != nil {
		return handleNucleiRefreshFailure(absToolPath, state, true, err)
	}
	return nucleiStatusFromState(state, 0, now), nil
}

func installedNucleiTemplateVersion(templatePath string, state nucleiTemplateState) string {
	readyVersion, err := os.ReadFile(filepath.Join(templatePath, nucleiTemplatesReadyFile))
	if err == nil {
		version := strings.TrimSpace(string(readyVersion))
		if toolUpdateVersionPattern.MatchString(strings.TrimPrefix(version, "v")) {
			return version
		}
	}
	if state.TemplateSource == nucleiTemplateSource &&
		toolUpdateVersionPattern.MatchString(strings.TrimPrefix(state.TemplateVersion, "v")) {
		return state.TemplateVersion
	}
	return ""
}

// runNucleiTemplateRefreshLoop performs inexpensive freshness checks on a
// fixed cadence. The reconciler itself decides whether an upstream refresh is
// due, so failed stale updates can be retried without modifying fresh caches.
func runNucleiTemplateRefreshLoop(
	ctx context.Context,
	checkInterval time.Duration,
	refresh func(context.Context) (nucleiScannerStatus, error),
	onResult func(nucleiScannerStatus, error),
) {
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			status, err := refresh(ctx)
			if onResult != nil {
				onResult(status, err)
			}
		}
	}
}

// reconcileNucleiTemplates validates the active set and refreshes it when its
// successful update is too old or the Nuclei engine version changed. A failed
// refresh remains non-fatal while the last-known-good set still validates.
func reconcileNucleiTemplates(
	ctx context.Context,
	toolPath string,
	options nucleiTemplateRefreshOptions,
	run commandOutputRunner,
) (nucleiScannerStatus, error) {
	absToolPath, nucleiPath, templatePath, err := nucleiInstallationPaths(toolPath)
	if err != nil {
		return nucleiScannerStatus{State: nucleiScannerStateError, LastError: boundedNucleiStatusError(err)}, err
	}

	now := options.now()
	state, stateErr := loadNucleiTemplateState(absToolPath)
	if state.TemplateSource == "" {
		state.TemplateSource = nucleiTemplateSource
	}

	engineVersion, engineErr := readNucleiEngineVersion(ctx, nucleiPath, run)
	activeReady, validationErr := validateNucleiTemplates(ctx, nucleiPath, templatePath, run)
	if validationErr == nil && activeReady {
		state.LastValidatedAt = now
	}

	if engineErr != nil {
		return handleNucleiRefreshFailure(absToolPath, state, activeReady, engineErr)
	}
	previousEngineVersion := state.EngineVersion
	state.EngineVersion = engineVersion

	refreshDue := stateErr != nil || state.LastSuccessAt.IsZero() ||
		now.Sub(state.LastSuccessAt) >= options.refreshInterval ||
		previousEngineVersion != engineVersion

	if activeReady && validationErr == nil && !refreshDue {
		state.LastError = ""
		if err := saveNucleiTemplateState(absToolPath, state); err != nil {
			return handleNucleiRefreshFailure(absToolPath, state, true, err)
		}
		return nucleiStatusFromState(state, options.maxStale, now), nil
	}
	if ctx.Err() != nil {
		return nucleiStatusFromState(state, options.maxStale, now), ctx.Err()
	}

	state.LastAttemptAt = now
	if err := saveNucleiTemplateState(absToolPath, state); err != nil && !activeReady {
		return nucleiScannerStatus{State: nucleiScannerStateError, LastError: boundedNucleiStatusError(err)}, err
	}

	// A worker that still has a valid set is refreshing and must reach the
	// upstream release; one with nothing usable is bootstrapping and may take
	// the baked seed instead.
	install := downloadAndActivateNucleiTemplates
	if !activeReady {
		install = bootstrapNucleiTemplates
	}
	templateVersion, updateErr := install(
		ctx,
		absToolPath,
		nucleiPath,
		templatePath,
		run,
	)
	if updateErr != nil {
		return handleNucleiRefreshFailure(absToolPath, state, activeReady, updateErr)
	}
	state.TemplateVersion = templateVersion
	state.TemplateSource = nucleiTemplateSource
	state.LastSuccessAt = now
	state.LastValidatedAt = now
	state.LastError = ""
	if err := saveNucleiTemplateState(absToolPath, state); err != nil {
		return handleNucleiRefreshFailure(absToolPath, state, true, err)
	}

	return nucleiStatusFromState(state, options.maxStale, now), nil
}

// ensureNucleiTemplates installs a validated template set into the persistent tool cache when one is missing.
func ensureNucleiTemplates(
	ctx context.Context,
	toolPath string,
	run commandOutputRunner,
) error {
	absToolPath, nucleiPath, templatePath, err := nucleiInstallationPaths(toolPath)
	if err != nil {
		return err
	}
	ready, validationErr := validateNucleiTemplates(ctx, nucleiPath, templatePath, run)
	if validationErr == nil && ready {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if isContextError(validationErr) {
		return validationErr
	}

	_, err = bootstrapNucleiTemplates(ctx, absToolPath, nucleiPath, templatePath, run)
	return err
}

// bootstrapNucleiTemplates installs a worker's first template set. The seed
// baked into the image is preferred because it needs neither network access
// nor a ~14k file download, which is what makes a freshly deployed worker
// scan-ready immediately instead of after a post-deployment update.
func bootstrapNucleiTemplates(
	ctx context.Context,
	absToolPath string,
	nucleiPath string,
	templatePath string,
	run commandOutputRunner,
) (string, error) {
	templateVersion, err := activateSeededNucleiTemplates(ctx, absToolPath, nucleiPath, run)
	if err == nil {
		templateLog.Success("Activated baked Nuclei template seed v%s", templateVersion)
		return templateVersion, nil
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if !errors.Is(err, errNucleiTemplateSeedUnavailable) {
		// A broken seed must not strand the worker: report it and let the
		// updater produce a template set the normal way.
		templateLog.Warning("Baked Nuclei template seed unusable, falling back to update: %v", err)
	}
	return downloadAndActivateNucleiTemplates(ctx, absToolPath, nucleiPath, templatePath, run)
}

// nucleiTemplateSeedPath reports the read-only template set shipped in the
// worker image. Unset (a locally built worker) disables seeding entirely.
func nucleiTemplateSeedPath() string {
	return strings.TrimSpace(os.Getenv(nucleiTemplateSeedEnvVar))
}

// activateSeededNucleiTemplates promotes the baked seed into the writable tool
// cache using the same immutable-version layout, validation and pointer publish
// as a downloaded set, so nothing downstream can tell the two apart.
func activateSeededNucleiTemplates(
	ctx context.Context,
	absToolPath string,
	nucleiPath string,
	run commandOutputRunner,
) (string, error) {
	seedPath := nucleiTemplateSeedPath()
	if seedPath == "" {
		return "", errNucleiTemplateSeedUnavailable
	}
	templateVersion, err := readNucleiTemplateSeedVersion(seedPath)
	if err != nil {
		return "", err
	}
	seeded, err := hasNucleiTemplates(seedPath)
	if err != nil {
		return "", fmt.Errorf("inspect baked nuclei template seed: %w", err)
	}
	if !seeded {
		return "", errNucleiTemplateSeedUnavailable
	}

	candidatePath, err := moveNucleiTemplatesToVersionedDirectory(
		absToolPath,
		seedPath,
		templateVersion,
	)
	if err != nil {
		return "", err
	}
	ready, err := validateNucleiTemplates(ctx, nucleiPath, candidatePath, run)
	if err != nil || !ready {
		_ = os.RemoveAll(candidatePath)
		if err != nil {
			return "", err
		}
		return "", errors.New("activate baked nuclei template seed: seeded template set is not valid")
	}
	if err := os.WriteFile(
		filepath.Join(candidatePath, nucleiTemplatesReadyFile),
		[]byte(templateVersion+"\n"),
		0o600,
	); err != nil {
		_ = os.RemoveAll(candidatePath)
		return "", fmt.Errorf("mark baked nuclei template seed ready: %w", err)
	}
	if err := publishNucleiTemplatesPointer(absToolPath, candidatePath); err != nil {
		return "", err
	}
	if err := installNucleiIgnoreList(candidatePath); err != nil {
		// A missing ignore list widens the template set rather than breaking
		// scanning, so this never blocks a worker from becoming ready.
		templateLog.Warning("Unable to install seeded Nuclei ignore list: %v", err)
	}
	cleanupObsoleteNucleiTemplateVersions(absToolPath, candidatePath)
	return templateVersion, nil
}

// nucleiConfigDirectory mirrors Nuclei's own resolution order so a seeded
// worker writes where the engine actually reads.
func nucleiConfigDirectory() string {
	if configured := strings.TrimSpace(os.Getenv(nucleiConfigDirEnvVar)); configured != "" {
		return configured
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".config", "nuclei")
}

// installNucleiIgnoreList publishes a template set's ignore list into Nuclei's
// configuration directory. `nuclei -ut` does this as part of an update, so a
// worker that only ever activated a baked seed would otherwise run templates
// the release marks as excluded.
func installNucleiIgnoreList(templatePath string) error {
	configDirectory := nucleiConfigDirectory()
	if configDirectory == "" {
		return errors.New("resolve nuclei configuration directory")
	}
	data, err := os.ReadFile(filepath.Join(templatePath, nucleiIgnoreFile))
	if err != nil {
		return fmt.Errorf("read seeded nuclei ignore list: %w", err)
	}
	if err := os.MkdirAll(configDirectory, 0o755); err != nil {
		return fmt.Errorf("create nuclei configuration directory: %w", err)
	}
	temporary, err := os.CreateTemp(configDirectory, ".nuclei-ignore-")
	if err != nil {
		return fmt.Errorf("create nuclei ignore list: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	if err := temporary.Chmod(0o644); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure nuclei ignore list: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write nuclei ignore list: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close nuclei ignore list: %w", err)
	}
	if err := os.Rename(temporaryPath, filepath.Join(configDirectory, nucleiIgnoreFile)); err != nil {
		return fmt.Errorf("activate nuclei ignore list: %w", err)
	}
	return nil
}

// readNucleiTemplateSeedVersion reads the release the image was built against.
// The version is trusted only as far as its format: an unreadable or malformed
// marker means the seed is not usable, never that an arbitrary string becomes
// the reported template version.
func readNucleiTemplateSeedVersion(seedPath string) (string, error) {
	data, err := os.ReadFile(filepath.Join(seedPath, nucleiTemplateSeedVersionFile))
	if err != nil {
		if os.IsNotExist(err) {
			return "", errNucleiTemplateSeedUnavailable
		}
		return "", fmt.Errorf("read baked nuclei template seed version: %w", err)
	}
	templateVersion := strings.TrimPrefix(strings.TrimSpace(string(data)), "v")
	if !toolUpdateVersionPattern.MatchString(templateVersion) {
		return "", fmt.Errorf(
			"baked nuclei template seed version is invalid: %q",
			templateVersion,
		)
	}
	return templateVersion, nil
}

func downloadAndActivateNucleiTemplates(
	ctx context.Context,
	absToolPath string,
	nucleiPath string,
	templatePath string,
	run commandOutputRunner,
) (string, error) {
	updaterPath := filepath.Join(absToolPath, nucleiTemplatesUpdaterDir)
	if err := prepareNucleiTemplateUpdater(absToolPath, templatePath, updaterPath); err != nil {
		return "", err
	}

	output, runErr := run(ctx, nucleiPath, "-ut", "-ud", updaterPath, "-silent")
	if runErr != nil {
		return "", fmt.Errorf(
			"bootstrap nuclei templates: %w%s",
			runErr,
			formatBootstrapOutput(output),
		)
	}

	ready, err := hasNucleiTemplates(updaterPath)
	if err != nil {
		return "", fmt.Errorf("validate downloaded nuclei templates: %w", err)
	}
	if !ready {
		return "", errors.New("bootstrap nuclei templates: update completed with no YAML templates")
	}
	ready, err = validateNucleiTemplates(ctx, nucleiPath, updaterPath, run)
	if err != nil {
		return "", err
	}
	if !ready {
		return "", errors.New("bootstrap nuclei templates: downloaded template set is not valid")
	}

	templateVersion, err := readNucleiTemplateVersion(ctx, nucleiPath, run)
	if err != nil {
		return "", err
	}

	candidatePath, err := moveNucleiTemplatesToVersionedDirectory(
		absToolPath,
		updaterPath,
		templateVersion,
	)
	if err != nil {
		return "", err
	}
	ready, err = validateNucleiTemplates(ctx, nucleiPath, candidatePath, run)
	if !ready {
		_ = os.RemoveAll(candidatePath)
		if err != nil {
			return "", err
		}
		return "", errors.New("activate nuclei templates: active template set is not valid")
	}
	if err := os.WriteFile(
		filepath.Join(candidatePath, nucleiTemplatesReadyFile),
		[]byte(templateVersion+"\n"),
		0o600,
	); err != nil {
		_ = os.RemoveAll(candidatePath)
		return "", fmt.Errorf("mark nuclei template candidate ready: %w", err)
	}
	if err := publishNucleiTemplatesPointer(absToolPath, candidatePath); err != nil {
		return "", err
	}
	cleanupObsoleteNucleiTemplateVersions(absToolPath, candidatePath, templatePath)
	return templateVersion, nil
}

func nucleiInstallationPaths(toolPath string) (string, string, string, error) {
	absToolPath, err := filepath.Abs(toolPath)
	if err != nil {
		return "", "", "", fmt.Errorf("resolve worker tool path: %w", err)
	}
	nucleiPath := filepath.Join(absToolPath, nucleiExecutableName())
	if info, statErr := os.Stat(nucleiPath); statErr != nil {
		return "", "", "", fmt.Errorf("locate nuclei executable: %w", statErr)
	} else if !info.Mode().IsRegular() {
		return "", "", "", fmt.Errorf("locate nuclei executable: %s is not a regular file", nucleiPath)
	}
	templatePath, err := resolveActiveNucleiTemplatePath(absToolPath)
	if err != nil {
		return "", "", "", err
	}
	return absToolPath, nucleiPath, templatePath, nil
}

func readNucleiEngineVersion(ctx context.Context, nucleiPath string, run commandOutputRunner) (string, error) {
	output, err := run(ctx, nucleiPath, "-version")
	if err != nil {
		return "", fmt.Errorf("read Nuclei engine version: %w%s", err, formatBootstrapOutput(output))
	}
	matches := nucleiEngineVersionPattern.FindSubmatch(output)
	if len(matches) != 2 {
		return "", fmt.Errorf("read Nuclei engine version: unrecognized output%s", formatBootstrapOutput(output))
	}
	return string(matches[1]), nil
}

func readNucleiTemplateVersion(ctx context.Context, nucleiPath string, run commandOutputRunner) (string, error) {
	output, err := run(ctx, nucleiPath, "-tv")
	if err != nil {
		return "", fmt.Errorf("read Nuclei template version: %w%s", err, formatBootstrapOutput(output))
	}
	matches := nucleiTemplateVersionPattern.FindSubmatch(output)
	if len(matches) != 2 {
		return "", fmt.Errorf("read Nuclei template version: unrecognized output%s", formatBootstrapOutput(output))
	}
	return string(matches[1]), nil
}

func loadNucleiTemplateState(toolPath string) (nucleiTemplateState, error) {
	data, err := os.ReadFile(filepath.Join(toolPath, nucleiTemplateStateFile))
	if err != nil {
		return nucleiTemplateState{}, err
	}
	var state nucleiTemplateState
	if err := json.Unmarshal(data, &state); err != nil {
		return nucleiTemplateState{}, fmt.Errorf("decode Nuclei template state: %w", err)
	}
	return state, nil
}

func saveNucleiTemplateState(toolPath string, state nucleiTemplateState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode Nuclei template state: %w", err)
	}
	temporary, err := os.CreateTemp(toolPath, ".nuclei-templates-state-")
	if err != nil {
		return fmt.Errorf("create Nuclei template state: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = os.Remove(temporaryPath)
	}()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure Nuclei template state: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write Nuclei template state: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Nuclei template state: %w", err)
	}
	if err := os.Rename(temporaryPath, filepath.Join(toolPath, nucleiTemplateStateFile)); err != nil {
		return fmt.Errorf("activate Nuclei template state: %w", err)
	}
	return nil
}

func handleNucleiRefreshFailure(
	toolPath string,
	state nucleiTemplateState,
	activeReady bool,
	err error,
) (nucleiScannerStatus, error) {
	state.LastError = boundedNucleiStatusError(err)
	_ = saveNucleiTemplateState(toolPath, state)
	status := nucleiStatusFromState(state, 0, time.Time{})
	if activeReady {
		status.State = nucleiScannerStateStale
		return status, nil
	}
	status.State = nucleiScannerStateError
	return status, err
}

func nucleiStatusFromState(state nucleiTemplateState, maxStale time.Duration, now time.Time) nucleiScannerStatus {
	status := nucleiScannerStatus{
		EngineVersion:       state.EngineVersion,
		TemplateVersion:     state.TemplateVersion,
		TemplateSource:      state.TemplateSource,
		LastUpdateAttemptAt: state.LastAttemptAt,
		LastUpdateSuccessAt: state.LastSuccessAt,
		LastValidatedAt:     state.LastValidatedAt,
		State:               nucleiScannerStateReady,
		LastError:           state.LastError,
	}
	if state.LastError != "" || (maxStale > 0 && !state.LastSuccessAt.IsZero() && now.Sub(state.LastSuccessAt) >= maxStale) {
		status.State = nucleiScannerStateStale
	}
	return status
}

func boundedNucleiStatusError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > maxNucleiStatusErrorBytes {
		return message[:maxNucleiStatusErrorBytes] + "..."
	}
	return message
}

// nucleiStatusForWrapperFailure makes failures outside the reconciler (for
// example tool download or cache-lock failures) visible to Core instead of
// emitting an empty status that Core rejects.
func nucleiStatusForWrapperFailure(
	toolPath string,
	options nucleiTemplateRefreshOptions,
	err error,
) nucleiScannerStatus {
	state, _ := loadNucleiTemplateState(toolPath)
	if state.TemplateSource == "" {
		state.TemplateSource = nucleiTemplateSource
	}
	state.LastAttemptAt = options.now()
	state.LastError = boundedNucleiStatusError(err)
	_ = saveNucleiTemplateState(toolPath, state)
	status := nucleiStatusFromState(state, options.maxStale, options.now())
	if state.LastValidatedAt.IsZero() {
		status.State = nucleiScannerStateError
	} else {
		status.State = nucleiScannerStateStale
	}
	return status
}

// validateNucleiTemplates uses Nuclei itself to validate a candidate template set.
func validateNucleiTemplates(
	ctx context.Context,
	nucleiPath string,
	templatePath string,
	run commandOutputRunner,
) (bool, error) {
	hasTemplates, err := hasNucleiTemplates(templatePath)
	if err != nil {
		return false, fmt.Errorf("inspect nuclei templates: %w", err)
	}
	if !hasTemplates {
		return false, nil
	}

	// -ud makes the set under validation its own helper root. Nuclei otherwise
	// resolves helper and payload files against its configured template
	// directory and rejects them all when that directory does not exist, which
	// would fail every candidate on a worker that has never run an update.
	output, runErr := run(
		ctx,
		nucleiPath,
		"-duc",
		"-ud",
		templatePath,
		"-validate",
		"-t",
		templatePath,
		"-silent",
	)
	if runErr != nil {
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		return false, fmt.Errorf(
			"validate nuclei templates: %w%s",
			runErr,
			formatBootstrapOutput(output),
		)
	}
	return true, nil
}

func moveNucleiTemplatesToVersionedDirectory(
	toolPath string,
	updaterPath string,
	templateVersion string,
) (string, error) {
	versionName := strings.TrimPrefix(templateVersion, "v")
	versionName = regexp.MustCompile(`[^0-9A-Za-z._-]+`).ReplaceAllString(versionName, "-")
	if versionName == "" {
		versionName = "unknown"
	}
	destination := filepath.Join(
		toolPath,
		fmt.Sprintf("%s%s-%d", nucleiTemplatesVersionPrefix, versionName, time.Now().UnixNano()),
	)
	if err := copyNucleiTemplateDirectory(updaterPath, destination); err != nil {
		_ = os.RemoveAll(destination)
		return "", fmt.Errorf("copy nuclei templates into immutable version directory: %w", err)
	}
	return destination, nil
}

// prepareNucleiTemplateUpdater keeps Nuclei's configured update directory at
// a stable path. Seeding it from the active immutable version is important:
// when the installed version is already current, `nuclei -ut` exits 0 without
// downloading files into a new empty directory.
func prepareNucleiTemplateUpdater(toolPath string, activePath string, updaterPath string) error {
	preparationPath, err := os.MkdirTemp(toolPath, nucleiTemplatesStagingPrefix)
	if err != nil {
		return fmt.Errorf("create nuclei template updater staging directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(preparationPath) }()

	activeReady, err := hasNucleiTemplates(activePath)
	if err != nil {
		return fmt.Errorf("inspect active nuclei templates before refresh: %w", err)
	}
	if activeReady {
		if err := copyNucleiTemplateDirectory(activePath, preparationPath); err != nil {
			return fmt.Errorf("seed nuclei template updater from active version: %w", err)
		}
	}

	if err := os.RemoveAll(updaterPath); err != nil {
		return fmt.Errorf("reset nuclei template updater: %w", err)
	}
	if err := os.Rename(preparationPath, updaterPath); err != nil {
		return fmt.Errorf("activate nuclei template updater directory: %w", err)
	}
	return nil
}

func copyNucleiTemplateDirectory(source string, destination string) error {
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relativePath, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relativePath == "." || relativePath == nucleiTemplatesReadyFile {
			return nil
		}
		destinationPath := filepath.Join(destination, relativePath)
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("refuse symbolic link in nuclei template set: %s", relativePath)
		}
		if entry.IsDir() {
			return os.MkdirAll(destinationPath, 0o755)
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("refuse non-regular nuclei template file: %s", relativePath)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(destinationPath, data, 0o644)
	})
}

func resolveActiveNucleiTemplatePath(toolPath string) (string, error) {
	pointerPath := filepath.Join(toolPath, nucleiTemplatesPointerFile)
	pointerData, err := os.ReadFile(pointerPath)
	if err == nil {
		candidate, resolveErr := resolveNucleiTemplatePointer(toolPath, string(pointerData))
		if resolveErr != nil {
			return "", resolveErr
		}
		return candidate, nil
	}
	if err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("read nuclei template pointer: %w", err)
	}

	readyCandidate, findErr := newestReadyNucleiTemplateDirectory(toolPath)
	if findErr != nil {
		return "", findErr
	}
	if readyCandidate != "" {
		return readyCandidate, nil
	}
	return filepath.Join(toolPath, nucleiTemplatesDirectory), nil
}

func resolveNucleiTemplatePointer(toolPath string, pointer string) (string, error) {
	name := strings.TrimSpace(pointer)
	if name == "" || filepath.Base(name) != name || !strings.HasPrefix(name, nucleiTemplatesVersionPrefix) {
		return "", errors.New("invalid nuclei template pointer")
	}
	candidate := filepath.Join(toolPath, name)
	if _, err := os.Stat(filepath.Join(candidate, nucleiTemplatesReadyFile)); err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("nuclei template pointer target is not ready: %s", name)
		}
		return "", fmt.Errorf("inspect nuclei template pointer target: %w", err)
	}
	return candidate, nil
}

func newestReadyNucleiTemplateDirectory(toolPath string) (string, error) {
	entries, err := os.ReadDir(toolPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("list nuclei template versions: %w", err)
	}
	var newestPath string
	var newestTime time.Time
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), nucleiTemplatesVersionPrefix) {
			continue
		}
		candidate := filepath.Join(toolPath, entry.Name())
		readyInfo, statErr := os.Stat(filepath.Join(candidate, nucleiTemplatesReadyFile))
		if statErr != nil {
			continue
		}
		if newestPath == "" || readyInfo.ModTime().After(newestTime) {
			newestPath = candidate
			newestTime = readyInfo.ModTime()
		}
	}
	return newestPath, nil
}

func publishNucleiTemplatesPointer(toolPath string, candidatePath string) error {
	name := filepath.Base(candidatePath)
	if filepath.Dir(candidatePath) != filepath.Clean(toolPath) || !strings.HasPrefix(name, nucleiTemplatesVersionPrefix) {
		return errors.New("publish nuclei template pointer: candidate is outside the tool path")
	}
	temporary, err := os.CreateTemp(toolPath, ".nuclei-templates-current-")
	if err != nil {
		return fmt.Errorf("create nuclei template pointer: %w", err)
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure nuclei template pointer: %w", err)
	}
	if _, err := temporary.WriteString(name + "\n"); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write nuclei template pointer: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync nuclei template pointer: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close nuclei template pointer: %w", err)
	}
	pointerPath := filepath.Join(toolPath, nucleiTemplatesPointerFile)
	if runtime.GOOS == "windows" {
		if err := os.Remove(pointerPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("replace nuclei template pointer: %w", err)
		}
	}
	if err := os.Rename(temporaryPath, pointerPath); err != nil {
		return fmt.Errorf("publish nuclei template pointer: %w", err)
	}
	return nil
}

func cleanupObsoleteNucleiTemplateVersions(toolPath string, keepPaths ...string) {
	keep := make(map[string]struct{}, len(keepPaths))
	for _, path := range keepPaths {
		keep[filepath.Clean(path)] = struct{}{}
	}
	entries, err := os.ReadDir(toolPath)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), nucleiTemplatesVersionPrefix) {
			continue
		}
		path := filepath.Join(toolPath, entry.Name())
		if _, shouldKeep := keep[filepath.Clean(path)]; shouldKeep {
			continue
		}
		_ = os.RemoveAll(path)
	}
}

// hasNucleiTemplates reports whether a directory contains at least one YAML template.
func hasNucleiTemplates(templatePath string) (bool, error) {
	if _, err := os.Stat(templatePath); err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}

	err := filepath.WalkDir(templatePath, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		extension := strings.ToLower(filepath.Ext(path))
		if extension == ".yaml" || extension == ".yml" {
			return errNucleiTemplateFound
		}
		return nil
	})
	if errors.Is(err, errNucleiTemplateFound) {
		return true, nil
	}
	return false, err
}

// nucleiExecutableName returns the platform-specific Nuclei executable name.
func nucleiExecutableName() string {
	if runtime.GOOS == "windows" {
		return "nuclei.exe"
	}
	return "nuclei"
}

// runCommandOutput executes a fixed executable and argument list without a shell.
func runCommandOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// formatBootstrapOutput adds bounded scanner output to a bootstrap error.
func formatBootstrapOutput(output []byte) string {
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" {
		return ""
	}
	if len(trimmed) > maxBootstrapErrorOutputBytes {
		trimmed = trimmed[:maxBootstrapErrorOutputBytes] + "..."
	}
	return ": " + trimmed
}
