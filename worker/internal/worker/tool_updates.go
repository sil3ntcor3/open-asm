package worker

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"debug/buildinfo"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/oasm-platform/oasm-sdk-go/oasm"
	"github.com/sil3ntcor3/open-asm/grpc-client/go/workers"
)

const maxToolUpdateArtifactBytes int64 = 256 * 1024 * 1024
const toolUpdatePollInterval = 15 * time.Second

var (
	toolUpdateVersionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
	toolOutputVersionPattern = regexp.MustCompile(`(?i)\bv?([0-9]+\.[0-9]+\.[0-9]+)\b`)
	toolBuildVersionPattern  = regexp.MustCompile(`(?:^|\s)-X(?:=|\s+)main\.version=v?([0-9]+\.[0-9]+\.[0-9]+)(?:\s|$)`)
	runtimeVersionPattern    = regexp.MustCompile(`(?i)\bv?([0-9]+\.[0-9]+(?:\.[0-9]+){0,2})\b`)
	toolUpdateDigestPattern  = regexp.MustCompile(`^[a-f0-9]{64}$`)
	toolUpdateRequestPattern = regexp.MustCompile(`^[a-f0-9-]{36}$`)
	managedToolRepositories  = map[string]string{
		"subfinder": "projectdiscovery/subfinder",
		"dnsx":      "projectdiscovery/dnsx",
		"httpx":     "projectdiscovery/httpx",
		"naabu":     "projectdiscovery/naabu",
		"nuclei":    "projectdiscovery/nuclei",
	}
)

type toolUpdateDirective struct {
	requestID     string
	component     string
	targetVersion string
	kind          string
	artifactName  string
	artifactURL   string
	sha256        string
}

type toolArtifactDownloader func(context.Context, string) ([]byte, error)

func validateToolUpdateDirective(directive toolUpdateDirective, goos string, goarch string) error {
	repository, managed := managedToolRepositories[directive.component]
	if !managed || directive.kind != "artifact" {
		return errors.New("tool update component is not artifact-managed")
	}
	if !toolUpdateRequestPattern.MatchString(directive.requestID) {
		return errors.New("tool update request ID is invalid")
	}
	if !toolUpdateVersionPattern.MatchString(directive.targetVersion) {
		return errors.New("tool update target version is invalid")
	}
	if !toolUpdateDigestPattern.MatchString(directive.sha256) {
		return errors.New("tool update digest is invalid")
	}
	platformOS := goos
	if platformOS == "darwin" {
		platformOS = "macOS"
	}
	expectedName := fmt.Sprintf(
		"%s_%s_%s_%s.zip",
		directive.component,
		directive.targetVersion,
		platformOS,
		goarch,
	)
	if directive.artifactName != expectedName {
		return errors.New("tool update artifact does not match the worker platform")
	}
	parsedURL, err := url.Parse(directive.artifactURL)
	if err != nil || parsedURL.Scheme != "https" || parsedURL.Host != "github.com" || parsedURL.RawQuery != "" || parsedURL.Fragment != "" {
		return errors.New("tool update release URL is not trusted")
	}
	expectedPath := fmt.Sprintf(
		"/%s/releases/download/v%s/%s",
		repository,
		directive.targetVersion,
		directive.artifactName,
	)
	if parsedURL.EscapedPath() != expectedPath {
		return errors.New("tool update release URL is not the expected official asset")
	}
	return nil
}

func applyArtifactToolUpdate(
	ctx context.Context,
	toolPath string,
	directive toolUpdateDirective,
	goos string,
	goarch string,
	download toolArtifactDownloader,
	run commandOutputRunner,
) (string, string, error) {
	if err := validateToolUpdateDirective(directive, goos, goarch); err != nil {
		return "", "", err
	}
	absToolPath, err := filepath.Abs(toolPath)
	if err != nil {
		return "", "", fmt.Errorf("resolve tool update directory: %w", err)
	}
	if err := os.MkdirAll(absToolPath, 0o755); err != nil {
		return "", "", fmt.Errorf("create tool update directory: %w", err)
	}
	executableName := directive.component
	if goos == "windows" {
		executableName += ".exe"
	}
	livePath := filepath.Join(absToolPath, executableName)
	rollbackVersion, err := readManagedToolVersion(ctx, livePath, run)
	if err != nil {
		return "", "", fmt.Errorf("read installed %s version: %w", directive.component, err)
	}
	if rollbackVersion == directive.targetVersion {
		return rollbackVersion, rollbackVersion, nil
	}

	archiveBytes, err := download(ctx, directive.artifactURL)
	if err != nil {
		return "", rollbackVersion, fmt.Errorf("download tool update: %w", err)
	}
	digest := sha256.Sum256(archiveBytes)
	if fmt.Sprintf("%x", digest) != directive.sha256 {
		return "", rollbackVersion, errors.New("tool update artifact digest does not match the verified release")
	}
	binaryBytes, err := extractManagedToolBinary(archiveBytes, executableName)
	if err != nil {
		return "", rollbackVersion, err
	}

	staged, err := os.CreateTemp(absToolPath, ".oasm-tool-update-stage-")
	if err != nil {
		return "", rollbackVersion, fmt.Errorf("create tool update staging file: %w", err)
	}
	stagedPath := staged.Name()
	defer func() { _ = os.Remove(stagedPath) }()
	if err := staged.Chmod(0o755); err != nil {
		_ = staged.Close()
		return "", rollbackVersion, fmt.Errorf("set staged tool permissions: %w", err)
	}
	if _, err := staged.Write(binaryBytes); err != nil {
		_ = staged.Close()
		return "", rollbackVersion, fmt.Errorf("write staged tool: %w", err)
	}
	if err := staged.Sync(); err != nil {
		_ = staged.Close()
		return "", rollbackVersion, fmt.Errorf("sync staged tool: %w", err)
	}
	if err := staged.Close(); err != nil {
		return "", rollbackVersion, fmt.Errorf("close staged tool: %w", err)
	}
	stagedVersion, err := readManagedToolVersion(ctx, stagedPath, run)
	if err != nil {
		return "", rollbackVersion, fmt.Errorf("staged tool smoke test failed for target %s: %w", directive.targetVersion, err)
	}
	if stagedVersion != directive.targetVersion {
		return "", rollbackVersion, fmt.Errorf("staged tool smoke test failed for target %s: reported version %q", directive.targetVersion, stagedVersion)
	}

	backup, err := os.CreateTemp(absToolPath, ".oasm-tool-update-backup-")
	if err != nil {
		return "", rollbackVersion, fmt.Errorf("reserve tool update rollback path: %w", err)
	}
	backupPath := backup.Name()
	if err := backup.Close(); err != nil {
		return "", rollbackVersion, fmt.Errorf("close tool update rollback file: %w", err)
	}
	if err := os.Remove(backupPath); err != nil {
		return "", rollbackVersion, fmt.Errorf("prepare tool update rollback path: %w", err)
	}
	defer func() { _ = os.Remove(backupPath) }()
	if err := os.Rename(livePath, backupPath); err != nil {
		return "", rollbackVersion, fmt.Errorf("stage current tool for rollback: %w", err)
	}
	if err := os.Rename(stagedPath, livePath); err != nil {
		_ = os.Rename(backupPath, livePath)
		return "", rollbackVersion, fmt.Errorf("activate tool update: %w", err)
	}
	activatedVersion, smokeErr := readManagedToolVersion(ctx, livePath, run)
	if smokeErr != nil || activatedVersion != directive.targetVersion {
		_ = os.Remove(livePath)
		restoreErr := os.Rename(backupPath, livePath)
		if restoreErr != nil {
			return "", rollbackVersion, fmt.Errorf("post-activation smoke test failed (%v); rollback failed: %w", smokeErr, restoreErr)
		}
		if smokeErr != nil {
			return "", rollbackVersion, fmt.Errorf("post-activation smoke test failed for target %s: %w", directive.targetVersion, smokeErr)
		}
		return "", rollbackVersion, fmt.Errorf("post-activation smoke test failed for target %s: reported version %q", directive.targetVersion, activatedVersion)
	}
	return activatedVersion, rollbackVersion, nil
}

// readManagedToolVersion smoke-tests a managed scanner and prefers the release
// version embedded by GoReleaser when the scanner's display banner is stale.
func readManagedToolVersion(ctx context.Context, binaryPath string, run commandOutputRunner) (string, error) {
	output, err := run(ctx, binaryPath, "-version")
	if err != nil {
		return "", fmt.Errorf("run version command: %w%s", err, formatBootstrapOutput(output))
	}
	matches := toolOutputVersionPattern.FindSubmatch(output)
	if len(matches) != 2 {
		return "", fmt.Errorf("unrecognized version output%s", formatBootstrapOutput(output))
	}
	if buildVersion := readManagedToolBuildVersion(binaryPath); buildVersion != "" {
		return buildVersion, nil
	}
	return string(matches[1]), nil
}

// readManagedToolBuildVersion extracts the main.version linker value recorded
// in Go build metadata, returning an empty string for binaries without it.
func readManagedToolBuildVersion(binaryPath string) string {
	info, err := buildinfo.ReadFile(binaryPath)
	if err != nil {
		return ""
	}
	for _, setting := range info.Settings {
		if setting.Key != "-ldflags" {
			continue
		}
		matches := toolBuildVersionPattern.FindStringSubmatch(setting.Value)
		if len(matches) == 2 {
			return matches[1]
		}
	}
	return ""
}

func readRuntimeToolVersion(
	ctx context.Context,
	binaryPath string,
	args []string,
	run commandOutputRunner,
) (string, error) {
	output, err := run(ctx, binaryPath, args...)
	if err != nil {
		return "", fmt.Errorf("run runtime version command: %w%s", err, formatBootstrapOutput(output))
	}
	matches := runtimeVersionPattern.FindSubmatch(output)
	if len(matches) != 2 {
		return "", fmt.Errorf("unrecognized runtime version output%s", formatBootstrapOutput(output))
	}
	return string(matches[1]), nil
}

func extractManagedToolBinary(archiveBytes []byte, executableName string) ([]byte, error) {
	archive, err := zip.NewReader(bytes.NewReader(archiveBytes), int64(len(archiveBytes)))
	if err != nil {
		return nil, fmt.Errorf("open tool update archive: %w", err)
	}
	var selected *zip.File
	for _, entry := range archive.File {
		cleanName := filepath.Clean(strings.ReplaceAll(entry.Name, "\\", "/"))
		if cleanName == "." || strings.HasPrefix(cleanName, "../") || filepath.IsAbs(cleanName) {
			return nil, errors.New("tool update archive contains an unsafe path")
		}
		if filepath.Base(cleanName) != executableName {
			continue
		}
		if selected != nil {
			return nil, errors.New("tool update archive contains multiple scanner binaries")
		}
		if entry.FileInfo().Mode()&os.ModeSymlink != 0 || entry.FileInfo().IsDir() {
			return nil, errors.New("tool update archive scanner is not a regular file")
		}
		if entry.UncompressedSize64 > uint64(maxToolUpdateArtifactBytes) {
			return nil, errors.New("tool update binary exceeds the size limit")
		}
		selected = entry
	}
	if selected == nil {
		return nil, fmt.Errorf("tool update archive does not contain %s", executableName)
	}
	reader, err := selected.Open()
	if err != nil {
		return nil, fmt.Errorf("open staged tool binary: %w", err)
	}
	defer func() { _ = reader.Close() }()
	binaryBytes, err := io.ReadAll(io.LimitReader(reader, maxToolUpdateArtifactBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read staged tool binary: %w", err)
	}
	if int64(len(binaryBytes)) > maxToolUpdateArtifactBytes {
		return nil, errors.New("tool update binary exceeds the size limit")
	}
	return binaryBytes, nil
}

func downloadToolUpdateArtifact(ctx context.Context, artifactURL string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, artifactURL, nil)
	if err != nil {
		return nil, err
	}
	httpClient := &http.Client{
		Timeout: 5 * time.Minute,
		CheckRedirect: func(request *http.Request, _ []*http.Request) error {
			trustedHosts := map[string]bool{
				"github.com":                           true,
				"objects.githubusercontent.com":        true,
				"release-assets.githubusercontent.com": true,
			}
			if request.URL.Scheme != "https" || !trustedHosts[request.URL.Host] {
				return errors.New("tool update redirect is not trusted")
			}
			return nil
		},
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("release server returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxToolUpdateArtifactBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxToolUpdateArtifactBytes {
		return nil, errors.New("tool update artifact exceeds the size limit")
	}
	return data, nil
}

func runToolUpdateLoop(
	ctx context.Context,
	client *oasm.Client,
	toolPath string,
	jobsActive func() bool,
	onError func(error),
) {
	check := func() {
		attemptCtx, cancel := context.WithTimeout(ctx, 6*time.Minute)
		defer cancel()
		if err := processToolUpdatePlan(attemptCtx, client, toolPath, jobsActive); err != nil && ctx.Err() == nil && onError != nil {
			onError(err)
		}
	}
	check()
	ticker := time.NewTicker(toolUpdatePollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			check()
		}
	}
}

func processToolUpdatePlan(
	ctx context.Context,
	client *oasm.Client,
	toolPath string,
	jobsActive func() bool,
) error {
	plan, err := client.Workers().GetToolUpdatePlan(
		client.WithAuth(ctx),
		&workers.ToolUpdatePlanRequest{Os: runtime.GOOS, Arch: runtime.GOARCH},
	)
	if err != nil {
		return fmt.Errorf("get tool update plan: %w", err)
	}
	var processingErrors []error
	for _, update := range plan.GetUpdates() {
		directive := toolUpdateDirectiveFromProto(update)
		if jobsActive != nil && jobsActive() {
			if reportErr := reportToolUpdateStatus(ctx, client, toolUpdateStatus{
				component:     directive.component,
				state:         "pending",
				requestID:     directive.requestID,
				targetVersion: directive.targetVersion,
			}); reportErr != nil {
				processingErrors = append(processingErrors, reportErr)
			}
			continue
		}

		attemptAt := time.Now().UTC()
		if reportErr := reportToolUpdateStatus(ctx, client, toolUpdateStatus{
			component:     directive.component,
			state:         "updating",
			requestID:     directive.requestID,
			targetVersion: directive.targetVersion,
			lastAttemptAt: attemptAt,
		}); reportErr != nil {
			processingErrors = append(processingErrors, reportErr)
			continue
		}

		var installedVersion string
		var rollbackVersion string
		applyErr := withToolCacheLock(ctx, toolPath, defaultToolCacheLockOptions, func() error {
			var updateErr error
			switch directive.kind {
			case "artifact":
				installedVersion, rollbackVersion, updateErr = applyArtifactToolUpdate(
					ctx,
					toolPath,
					directive,
					runtime.GOOS,
					runtime.GOARCH,
					downloadToolUpdateArtifact,
					runCommandOutput,
				)
			case "templates":
				installedVersion, rollbackVersion, updateErr = applyNucleiTemplateUpdate(
					ctx,
					toolPath,
					directive,
					time.Now().UTC(),
					runCommandOutput,
				)
			default:
				updateErr = errors.New("unsupported tool update kind")
			}
			return updateErr
		})
		completedAt := time.Now().UTC()
		status := toolUpdateStatus{
			component:        directive.component,
			installedVersion: installedVersion,
			requestID:        directive.requestID,
			targetVersion:    directive.targetVersion,
			rollbackVersion:  rollbackVersion,
			lastAttemptAt:    attemptAt,
		}
		if applyErr != nil {
			status.state = "failed"
			status.installedVersion = rollbackVersion
			status.errorMessage = boundedToolUpdateError(applyErr)
			processingErrors = append(processingErrors, fmt.Errorf("update %s: %w", directive.component, applyErr))
		} else {
			status.state = "succeeded"
			status.lastSuccessAt = completedAt
		}
		if reportErr := reportToolUpdateStatus(ctx, client, status); reportErr != nil {
			processingErrors = append(processingErrors, reportErr)
		}
	}
	return errors.Join(processingErrors...)
}

func toolUpdateDirectiveFromProto(update *workers.ToolUpdateDirective) toolUpdateDirective {
	return toolUpdateDirective{
		requestID:     update.GetRequestId(),
		component:     update.GetComponent(),
		targetVersion: strings.TrimPrefix(update.GetTargetVersion(), "v"),
		kind:          update.GetKind(),
		artifactName:  update.GetArtifactName(),
		artifactURL:   update.GetArtifactUrl(),
		sha256:        update.GetSha256(),
	}
}

func applyNucleiTemplateUpdate(
	ctx context.Context,
	toolPath string,
	directive toolUpdateDirective,
	now time.Time,
	run commandOutputRunner,
) (string, string, error) {
	if directive.component != "nuclei-templates" || directive.kind != "templates" ||
		!toolUpdateRequestPattern.MatchString(directive.requestID) ||
		!toolUpdateVersionPattern.MatchString(directive.targetVersion) {
		return "", "", errors.New("Nuclei template update directive is invalid")
	}
	absToolPath, nucleiPath, activeTemplatePath, err := nucleiInstallationPaths(toolPath)
	if err != nil {
		return "", "", err
	}
	state, _ := loadNucleiTemplateState(absToolPath)
	rollbackVersion := strings.TrimPrefix(state.TemplateVersion, "v")
	if rollbackVersion == directive.targetVersion {
		return directive.targetVersion, rollbackVersion, nil
	}
	updatedVersion, err := downloadAndActivateNucleiTemplates(
		ctx,
		absToolPath,
		nucleiPath,
		activeTemplatePath,
		run,
	)
	if err != nil {
		return "", rollbackVersion, err
	}
	updatedVersion = strings.TrimPrefix(updatedVersion, "v")
	if updatedVersion != directive.targetVersion {
		if restoreErr := publishNucleiTemplatesPointer(absToolPath, activeTemplatePath); restoreErr != nil {
			return "", rollbackVersion, fmt.Errorf("template version mismatch (%s); rollback failed: %w", updatedVersion, restoreErr)
		}
		return "", rollbackVersion, fmt.Errorf("template updater installed %s instead of approved %s", updatedVersion, directive.targetVersion)
	}
	state.TemplateVersion = updatedVersion
	state.TemplateSource = nucleiTemplateSource
	state.LastAttemptAt = now
	state.LastSuccessAt = now
	state.LastValidatedAt = now
	state.LastError = ""
	if engineVersion, versionErr := readNucleiEngineVersion(ctx, nucleiPath, run); versionErr == nil {
		state.EngineVersion = engineVersion
	}
	if err := saveNucleiTemplateState(absToolPath, state); err != nil {
		if restoreErr := publishNucleiTemplatesPointer(absToolPath, activeTemplatePath); restoreErr != nil {
			return "", rollbackVersion, fmt.Errorf("save template update state: %v; rollback failed: %w", err, restoreErr)
		}
		return "", rollbackVersion, fmt.Errorf("save template update state: %w", err)
	}
	return updatedVersion, rollbackVersion, nil
}

type toolUpdateStatus struct {
	component        string
	installedVersion string
	state            string
	requestID        string
	targetVersion    string
	rollbackVersion  string
	lastAttemptAt    time.Time
	lastSuccessAt    time.Time
	errorMessage     string
}

func reportToolUpdateStatus(ctx context.Context, client *oasm.Client, status toolUpdateStatus) error {
	request := &workers.ToolStatusReportRequest{
		Component: status.component,
		State:     status.state,
	}
	setOptionalString := func(value string) *string {
		if value == "" {
			return nil
		}
		return &value
	}
	request.InstalledVersion = setOptionalString(status.installedVersion)
	request.RequestId = setOptionalString(status.requestID)
	request.TargetVersion = setOptionalString(status.targetVersion)
	request.RollbackVersion = setOptionalString(status.rollbackVersion)
	request.Error = setOptionalString(status.errorMessage)
	if !status.lastAttemptAt.IsZero() {
		value := status.lastAttemptAt.Format(time.RFC3339Nano)
		request.LastAttemptAt = &value
	}
	if !status.lastSuccessAt.IsZero() {
		value := status.lastSuccessAt.Format(time.RFC3339Nano)
		request.LastSuccessAt = &value
	}
	if _, err := client.Workers().ReportToolStatus(client.WithAuth(ctx), request); err != nil {
		return fmt.Errorf("report %s tool update status: %w", status.component, err)
	}
	return nil
}

func reportInstalledToolVersions(
	ctx context.Context,
	client *oasm.Client,
	toolPath string,
	nucleiStatus nucleiScannerStatus,
) error {
	var reportErrors []error
	for component := range managedToolRepositories {
		version, err := readManagedToolVersion(
			ctx,
			filepath.Join(toolPath, platformExecutableName(component, runtime.GOOS)),
			runCommandOutput,
		)
		if err != nil {
			reportErrors = append(reportErrors, fmt.Errorf("read %s version: %w", component, err))
			continue
		}
		if err := reportToolUpdateStatus(ctx, client, toolUpdateStatus{
			component:        component,
			installedVersion: version,
			state:            "ready",
		}); err != nil {
			reportErrors = append(reportErrors, err)
		}
	}
	workerImageRuntimes := []struct {
		component string
		path      string
		args      []string
	}{
		{component: "nmap", path: "nmap", args: []string{"--version"}},
		{component: "screenshot", path: resolveChromiumBin(), args: []string{"--version"}},
	}
	for _, toolRuntime := range workerImageRuntimes {
		if toolRuntime.path == "" {
			continue
		}
		binaryPath, err := exec.LookPath(toolRuntime.path)
		if err != nil {
			reportErrors = append(reportErrors, fmt.Errorf("locate %s runtime: %w", toolRuntime.component, err))
			continue
		}
		version, err := readRuntimeToolVersion(ctx, binaryPath, toolRuntime.args, runCommandOutput)
		if err != nil {
			reportErrors = append(reportErrors, fmt.Errorf("read %s runtime version: %w", toolRuntime.component, err))
			continue
		}
		if err := reportToolUpdateStatus(ctx, client, toolUpdateStatus{
			component:        toolRuntime.component,
			installedVersion: version,
			state:            "ready",
		}); err != nil {
			reportErrors = append(reportErrors, err)
		}
	}
	templateVersion := strings.TrimPrefix(nucleiStatus.TemplateVersion, "v")
	if templateVersion != "" {
		if err := reportToolUpdateStatus(ctx, client, toolUpdateStatus{
			component:        "nuclei-templates",
			installedVersion: templateVersion,
			state:            "ready",
		}); err != nil {
			reportErrors = append(reportErrors, err)
		}
	}
	return errors.Join(reportErrors...)
}

func platformExecutableName(component string, goos string) string {
	if goos == "windows" {
		return component + ".exe"
	}
	return component
}

func boundedToolUpdateError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > maxNucleiStatusErrorBytes {
		return message[:maxNucleiStatusErrorBytes] + "..."
	}
	return message
}
