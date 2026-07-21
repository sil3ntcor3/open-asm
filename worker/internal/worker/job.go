package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-rod/rod"
	"github.com/oasm-platform/oasm-sdk-go/oasm"
	"github.com/sil3ntcor3/open-asm/grpc-client/go/jobs_registry"
)

type executionOutcome string

const (
	executionOutcomeSucceeded     executionOutcome = "succeeded"
	executionOutcomeFailed        executionOutcome = "failed"
	executionOutcomeTimedOut      executionOutcome = "timed_out"
	executionOutcomeCanceled      executionOutcome = "canceled"
	executionOutcomeOutputLimited executionOutcome = "output_limited"
	executionOutcomeStartFailed   executionOutcome = "start_failed"
)

type executionLimits struct {
	timeout          time.Duration
	stdoutLimitBytes int64
	stderrLimitBytes int64
}

type commandExecutionResult struct {
	outcome        executionOutcome
	exitCode       int32
	stdout         string
	stderr         string
	failureMessage string
	stdoutLimited  bool
	stderrLimited  bool
	outputLimited  bool
}

const maxExecutionTargetBytes = 16 * 1024

type toolInvocation struct {
	executable string
	args       []string
	stdin      string
}

type boundedBuffer struct {
	mu      sync.Mutex
	buffer  bytes.Buffer
	limit   int64
	limited bool
	onLimit func()
}

func (w *boundedBuffer) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	written := len(data)
	remaining := w.limit - int64(w.buffer.Len())
	if remaining > 0 {
		toWrite := int64(len(data))
		if toWrite > remaining {
			toWrite = remaining
		}
		_, _ = w.buffer.Write(data[:toWrite])
	}

	if int64(len(data)) > remaining && !w.limited {
		w.limited = true
		if w.onLimit != nil {
			w.onLimit()
		}
	}

	return written, nil
}

func (w *boundedBuffer) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buffer.String()
}

func (w *boundedBuffer) Limited() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.limited
}

var jobLogGlobal = oasm.NewLogger("Worker.Job")

func processJob(
	ctx context.Context,
	client *oasm.Client,
	browser *rod.Browser,
	toolPath string,
	limits executionLimits,
) {
	job, err := client.JobsNext(ctx)
	if err != nil {
		jobLogGlobal.ErrorE("Failed to pull job", err)
		return
	}
	if job == nil || job.Id == "" {
		return
	}

	jobCtx, cancelJob := context.WithCancel(ctx)
	defer cancelJob()

	handle := &jobHandle{id: job.Id, cancel: cancelJob}
	activeJobs.add(handle)
	defer activeJobs.remove(job.Id)

	execution := job.GetExecution()
	if execution == nil || execution.GetToolName() == "" || execution.GetTarget() == "" {
		jobLogGlobal.Warning("[%s] Missing typed execution plan", job.Id)
		_ = client.JobsResult(ctx, job.Id, executionFailurePayload(
			executionOutcomeStartFailed,
			-1,
			"No typed execution plan provided by Core",
			"",
			"",
			false,
			false,
		))
		return
	}

	jobLogGlobal.Info("[%s] Executing allowlisted tool: %s", job.Id, execution.GetToolName())
	var payload *jobs_registry.DataPayloadResult

	if execution.GetToolName() == "screenshot" {
		url := execution.GetTarget()
		jobLogGlobal.Debug("[%s] Capturing screenshot: %s", job.Id, url)

		screenshotCtx, cancelScreenshot := context.WithTimeout(jobCtx, limits.timeout)
		base64Image, captureErr := TakeScreenshotBase64(screenshotCtx, browser, url)
		cancelScreenshot()

		if captureErr != nil {
			if errors.Is(screenshotCtx.Err(), context.DeadlineExceeded) {
				captureErr = fmt.Errorf("screenshot deadline exceeded: %w", context.DeadlineExceeded)
			} else if jobCtx.Err() != nil {
				captureErr = fmt.Errorf("screenshot canceled: %w", context.Canceled)
			}
			jobLogGlobal.Warning("[%s] Screenshot capture failed: %v", job.Id, captureErr)
		}

		payload = screenshotPayload(url, base64Image, captureErr)
		if !payload.Error && int64(len(payload.GetRaw())) > limits.stdoutLimitBytes {
			payload = executionFailurePayload(
				executionOutcomeOutputLimited,
				-1,
				fmt.Sprintf("screenshot result exceeded %d bytes", limits.stdoutLimitBytes),
				payload.GetRaw()[:limits.stdoutLimitBytes],
				"",
				true,
				false,
			)
		}
	} else {
		result := runToolExecution(
			jobCtx,
			execution,
			toolPath,
			limits.timeout,
			limits.stdoutLimitBytes,
			limits.stderrLimitBytes,
			handle,
		)
		// nmap emits greppable text; parse it into the service JSON Core expects
		// so the parsing quirks stay worker-side. A parse/encode error leaves the
		// raw output in place rather than failing the job.
		if execution.GetToolName() == "nmap" && result.outcome == executionOutcomeSucceeded {
			if servicesJSON, encodeErr := nmapServicesJSON(result.stdout); encodeErr == nil {
				result.stdout = servicesJSON
			} else {
				jobLogGlobal.Warning("[%s] Failed to encode nmap services: %v", job.Id, encodeErr)
			}
		}
		payload = executionPayload(result)
	}

	if err := client.JobsResult(ctx, job.Id, payload); err != nil {
		jobLogGlobal.ErrorE(fmt.Sprintf("[%s] Failed to submit result", job.Id), err)
		return
	}

	if payload.Error {
		jobLogGlobal.Warning("[%s] Finished with outcome %s: %s", job.Id, payload.Outcome.String(), payload.FailureMessage)
		return
	}
	jobLogGlobal.Success("[%s] Completed", job.Id)
}

func runToolExecution(
	ctx context.Context,
	execution *jobs_registry.ToolExecution,
	toolPath string,
	timeout time.Duration,
	stdoutLimitBytes int64,
	stderrLimitBytes int64,
	handle *jobHandle,
) commandExecutionResult {
	invocation, err := buildToolInvocation(toolPath, execution)
	if err != nil {
		return commandExecutionResult{
			outcome:        executionOutcomeStartFailed,
			exitCode:       -1,
			failureMessage: err.Error(),
		}
	}

	if execution.GetToolName() != "subfinder" {
		return runDirectCommand(
			ctx,
			invocation,
			toolPath,
			timeout,
			stdoutLimitBytes,
			stderrLimitBytes,
			handle,
		)
	}

	target := execution.GetTarget()
	deadline := time.Now().Add(timeout)
	subfinderResult := runDirectCommand(
		ctx,
		invocation,
		toolPath,
		timeout,
		stdoutLimitBytes,
		stderrLimitBytes,
		handle,
	)
	if subfinderResult.outcome != executionOutcomeSucceeded {
		return subfinderResult
	}

	// Pass 1: wildcard filtering. Parked / wildcard-DNS domains (e.g. HugeDomains
	// parking) resolve every possible label to the same address, so subfinder's
	// passive sources return inflated junk such as mx.mx.mx.mx.<domain>. dnsx -wd
	// probes the wildcard root and drops any name that only matches the wildcard
	// set, while keeping genuinely distinct subdomains and always keeping the apex.
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return subfinderDeadlineExceeded(timeout, subfinderResult.stderr)
	}
	filterResult := runDirectCommand(
		ctx,
		dnsxWildcardFilterInvocation(toolPath, target, subfinderResult.stdout),
		toolPath,
		remaining,
		stdoutLimitBytes,
		stderrLimitBytes,
		handle,
	)

	// The apex is enriched unconditionally below, so an empty or failed filter
	// pass falls back to the apex only. That guarantees a transient dnsx error
	// can never silently reintroduce the wildcard-inflated junk it exists to drop.
	cleanHosts := filterResult.stdout
	if filterResult.outcome != executionOutcomeSucceeded {
		jobLogGlobal.Warning(
			"Wildcard filter pass failed for %s (%s); enriching apex only",
			target, filterResult.outcome,
		)
		cleanHosts = ""
	}

	// Pass 2: enrich the filtered host list with the DNS record types the Core
	// parser consumes. Output format is unchanged from the previous single dnsx
	// pass, so the built-in subfinder parser needs no changes.
	remaining = time.Until(deadline)
	if remaining <= 0 {
		return subfinderDeadlineExceeded(timeout, subfinderResult.stderr)
	}
	dnsxResult := runDirectCommand(
		ctx,
		dnsxEnrichInvocation(toolPath, target, cleanHosts),
		toolPath,
		remaining,
		stdoutLimitBytes,
		stderrLimitBytes,
		handle,
	)
	dnsxResult.stderr = subfinderResult.stderr + filterResult.stderr + dnsxResult.stderr
	return dnsxResult
}

func subfinderDeadlineExceeded(timeout time.Duration, stderr string) commandExecutionResult {
	return commandExecutionResult{
		outcome:        executionOutcomeTimedOut,
		exitCode:       -1,
		failureMessage: fmt.Sprintf("command exceeded deadline %s", timeout),
		stderr:         stderr,
	}
}

// dnsxWildcardFilterInvocation builds the dnsx pass that removes wildcard-DNS
// noise. -wd forces dnsx to emit hostnames only (record-type flags are ignored
// in this mode), so its output is fed into the enrich pass rather than parsed.
func dnsxWildcardFilterInvocation(toolPath, target, hosts string) toolInvocation {
	return toolInvocation{
		executable: scannerExecutable(toolPath, "dnsx"),
		args:       []string{"-duc", "-wd", target, "-silent"},
		stdin:      target + "\n" + hosts,
	}
}

// dnsxEnrichInvocation builds the dnsx pass that resolves the full set of DNS
// record types consumed by the Core subfinder parser. The apex target is always
// prepended so the primary asset is enriched even when hosts is empty.
func dnsxEnrichInvocation(toolPath, target, hosts string) toolInvocation {
	return toolInvocation{
		executable: scannerExecutable(toolPath, "dnsx"),
		args:       []string{"-duc", "-a", "-aaaa", "-cname", "-mx", "-ns", "-soa", "-txt", "-resp"},
		stdin:      target + "\n" + hosts,
	}
}

func buildToolInvocation(toolPath string, execution *jobs_registry.ToolExecution) (toolInvocation, error) {
	if execution == nil {
		return toolInvocation{}, errors.New("missing typed execution plan")
	}
	target := execution.GetTarget()
	if target == "" {
		return toolInvocation{}, errors.New("execution target is empty")
	}
	if len(target) > maxExecutionTargetBytes {
		return toolInvocation{}, fmt.Errorf("execution target exceeds %d bytes", maxExecutionTargetBytes)
	}

	switch execution.GetToolName() {
	case "httpx":
		// One asset_service == one (host, port) discovered by naabu, probed here
		// individually. -follow-redirects is deliberately omitted: with it, httpx
		// chases the request to a different endpoint (e.g. http://host:80 ->
		// https://host:443) and reports that endpoint's result under this service.
		// When the redirect target's TLS is broken the whole probe is flagged
		// failed=true / status_code=0, discarding the response this port actually
		// returned. Redirect targets are separate services naabu also finds and
		// httpx probes on their own, so this probe describes only the endpoint it
		// was handed. -location still records the redirect target for visibility.
		return toolInvocation{
			executable: scannerExecutable(toolPath, "httpx"),
			args: []string{
				"-duc", "-u", target, "-status-code", "-favicon", "-asn", "-title",
				"-web-server", "-irr", "-tech-detect", "-ip", "-cname", "-location",
				"-tls-grab", "-cdn", "-probe", "-json", "-timeout",
				"10",
				// Reliability: the port-scan burst that precedes httpx can trip a
				// target's IPS/rate-limiter, which then drops the worker's packets
				// for a short window — long enough that a single httpx attempt times
				// out and marks even a real web service failed. Retrying extends the
				// probe window past that transient block so a later attempt lands.
				"-retries", "2",
				"-threads", "100", "-silent",
			},
		}, nil
	case "naabu":
		return toolInvocation{
			executable: scannerExecutable(toolPath, "naabu"),
			// -rate throttles the SYN burst well below naabu's default 1000 pps.
			// That aggressive burst (top-1000 ports across every subdomain, from
			// several workers at once) is what trips target-side scan detection and
			// gets the worker IP filtered — which then makes the immediately
			// following nmap report open ports as "filtered" (losing the web scheme)
			// and the httpx probes time out. 500 pps still tripped a hardened target
			// (pentest-ground.com), so hold the rate to 150: top-1000 ports still
			// finishes in seconds while staying under common detection thresholds.
			// This only makes blocks rarer; the pipeline's resilience fixes
			// (filtered-port enrichment, best-effort screenshots, chain skip-forward)
			// keep discovery correct for blocks that still slip through.
			args: []string{"-host", target, "-silent", "-top-ports", "1000", "-rate", "150"},
		}, nil
	case "nmap":
		// asset_service targets are "host:port"; nmap needs the host and the
		// single discovered port separately. Prefer the typed port from the
		// execution plan, falling back to the suffix of the target.
		host := target
		port := int(execution.GetPort())
		if idx := strings.LastIndex(target, ":"); idx >= 0 {
			host = target[:idx]
			if port == 0 {
				if parsed, convErr := strconv.Atoi(target[idx+1:]); convErr == nil {
					port = parsed
				}
			}
		}
		if host == "" || port <= 0 {
			return toolInvocation{}, errors.New("nmap service discovery requires host:port")
		}
		return nmapServiceInvocation(host, []int{port}), nil
	case "nuclei":
		absToolPath, err := filepath.Abs(toolPath)
		if err != nil {
			return toolInvocation{}, fmt.Errorf("resolve worker tool path: %w", err)
		}
		templatePath, err := resolveActiveNucleiTemplatePath(absToolPath)
		if err != nil {
			return toolInvocation{}, fmt.Errorf("resolve active Nuclei templates: %w", err)
		}
		ready, err := hasNucleiTemplates(templatePath)
		if err != nil || !ready {
			if err != nil {
				return toolInvocation{}, fmt.Errorf("inspect active Nuclei templates: %w", err)
			}
			return toolInvocation{}, errors.New("active Nuclei templates are unavailable")
		}
		return toolInvocation{
			executable: scannerExecutable(toolPath, "nuclei"),
			args:       []string{"-duc", "-t", templatePath, "-u", target, "-j", "--silent"},
		}, nil
	case "subfinder":
		return toolInvocation{
			executable: scannerExecutable(toolPath, "subfinder"),
			args:       []string{"-duc", "-d", target},
		}, nil
	default:
		return toolInvocation{}, fmt.Errorf("tool %q is not allowlisted for worker execution", execution.GetToolName())
	}
}

func scannerExecutable(toolPath string, toolName string) string {
	name := toolName
	if filepath.Ext(name) == "" && isWindowsPlatform() {
		name += ".exe"
	}
	if toolPath == "" {
		return name
	}
	return filepath.Join(toolPath, name)
}

var isWindowsPlatform = func() bool { return filepath.Separator == '\\' }

// runDirectCommand executes one fixed binary and argument vector with bounded
// output and a hard deadline. It never invokes a command shell.
func runDirectCommand(
	ctx context.Context,
	invocation toolInvocation,
	toolPath string,
	timeout time.Duration,
	stdoutLimitBytes int64,
	stderrLimitBytes int64,
	handle *jobHandle,
) commandExecutionResult {
	if errors.Is(ctx.Err(), context.Canceled) {
		return commandExecutionResult{
			outcome:        executionOutcomeCanceled,
			exitCode:       -1,
			failureMessage: "command canceled",
		}
	}

	executionCtx, cancelExecution := context.WithTimeout(ctx, timeout)
	defer cancelExecution()

	var limitOnce sync.Once
	onLimit := func() {
		limitOnce.Do(cancelExecution)
	}
	stdout := &boundedBuffer{limit: stdoutLimitBytes, onLimit: onLimit}
	stderr := &boundedBuffer{limit: stderrLimitBytes, onLimit: onLimit}

	cmd := exec.CommandContext(executionCtx, invocation.executable, invocation.args...)
	cmd.SysProcAttr = newSysProcAttr()
	cmd.Env = setupCmdEnv(toolPath)
	if toolPath != "" {
		cmd.Dir = toolPath
	}
	cmd.Cancel = func() error { return killCommand(cmd) }
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if invocation.stdin != "" {
		cmd.Stdin = strings.NewReader(invocation.stdin)
	}

	if err := cmd.Start(); err != nil {
		return commandExecutionResult{
			outcome:        executionOutcomeStartFailed,
			exitCode:       -1,
			failureMessage: fmt.Sprintf("failed to start command: %v", err),
		}
	}
	if handle != nil {
		handle.setPid(cmd.Process.Pid)
	}

	runErr := cmd.Wait()
	result := commandExecutionResult{
		exitCode:      int32(cmd.ProcessState.ExitCode()),
		stdout:        stdout.String(),
		stderr:        stderr.String(),
		stdoutLimited: stdout.Limited(),
		stderrLimited: stderr.Limited(),
	}
	result.outputLimited = result.stdoutLimited || result.stderrLimited

	switch {
	case result.outputLimited:
		result.outcome = executionOutcomeOutputLimited
		result.failureMessage = "command output exceeded the configured limit"
	case errors.Is(ctx.Err(), context.Canceled):
		result.outcome = executionOutcomeCanceled
		result.failureMessage = "command canceled"
	case errors.Is(executionCtx.Err(), context.DeadlineExceeded):
		result.outcome = executionOutcomeTimedOut
		result.failureMessage = fmt.Sprintf("command exceeded deadline %s", timeout)
	case runErr != nil:
		result.outcome = executionOutcomeFailed
		result.failureMessage = fmt.Sprintf("command exited with code %d", result.exitCode)
	default:
		result.outcome = executionOutcomeSucceeded
	}

	return result
}

func executionPayload(result commandExecutionResult) *jobs_registry.DataPayloadResult {
	if result.outcome != executionOutcomeSucceeded {
		return executionFailurePayload(
			result.outcome,
			result.exitCode,
			result.failureMessage,
			result.stdout,
			result.stderr,
			result.stdoutLimited,
			result.stderrLimited,
		)
	}

	return &jobs_registry.DataPayloadResult{
		Error:    false,
		Raw:      &result.stdout,
		Outcome:  jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_SUCCEEDED,
		ExitCode: result.exitCode,
		Stderr:   result.stderr,
	}
}

func executionFailurePayload(
	outcome executionOutcome,
	exitCode int32,
	message string,
	stdout string,
	stderr string,
	stdoutLimited bool,
	stderrLimited bool,
) *jobs_registry.DataPayloadResult {
	return &jobs_registry.DataPayloadResult{
		Error:           true,
		Raw:             &stdout,
		Outcome:         protoExecutionOutcome(outcome),
		ExitCode:        exitCode,
		FailureMessage:  message,
		StdoutTruncated: stdoutLimited,
		StderrTruncated: stderrLimited,
		Stderr:          stderr,
	}
}

func protoExecutionOutcome(outcome executionOutcome) jobs_registry.ExecutionOutcome {
	switch outcome {
	case executionOutcomeSucceeded:
		return jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_SUCCEEDED
	case executionOutcomeTimedOut:
		return jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_TIMED_OUT
	case executionOutcomeCanceled:
		return jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_CANCELED
	case executionOutcomeOutputLimited:
		return jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_OUTPUT_LIMITED
	case executionOutcomeStartFailed:
		return jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_START_FAILED
	default:
		return jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_FAILED
	}
}

func screenshotPayload(rawURL string, screenshot string, captureErr error) *jobs_registry.DataPayloadResult {
	if captureErr != nil {
		outcome := executionOutcomeFailed
		if errors.Is(captureErr, context.DeadlineExceeded) {
			outcome = executionOutcomeTimedOut
		} else if errors.Is(captureErr, context.Canceled) {
			outcome = executionOutcomeCanceled
		}
		return executionFailurePayload(outcome, -1, captureErr.Error(), "", "", false, false)
	}

	resultData := struct {
		Screenshot string `json:"screenshot"`
		URL        string `json:"url"`
	}{
		Screenshot: screenshot,
		URL:        formatURL(rawURL),
	}
	jsonBytes, err := json.Marshal(resultData)
	if err != nil {
		return executionFailurePayload(
			executionOutcomeFailed,
			-1,
			fmt.Sprintf("failed to encode screenshot result: %v", err),
			"",
			"",
			false,
			false,
		)
	}
	raw := string(jsonBytes)
	return &jobs_registry.DataPayloadResult{
		Error:   false,
		Raw:     &raw,
		Outcome: jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_SUCCEEDED,
	}
}
