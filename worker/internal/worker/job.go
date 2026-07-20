package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
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

	cmdStr := job.GetCommand()
	if cmdStr == "" {
		jobLogGlobal.Warning("[%s] Empty command", job.Id)
		_ = client.JobsResult(ctx, job.Id, executionFailurePayload(
			executionOutcomeStartFailed,
			-1,
			"No command provided by Core",
			"",
			"",
			false,
			false,
		))
		return
	}

	jobLogGlobal.Info("[%s] Executing: %s", job.Id, cmdStr)
	var payload *jobs_registry.DataPayloadResult

	if after, ok := strings.CutPrefix(cmdStr, "screenshot "); ok {
		url := strings.TrimSpace(after)
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
		result := runToolCommand(
			jobCtx,
			cmdStr,
			toolPath,
			limits.timeout,
			limits.stdoutLimitBytes,
			limits.stderrLimitBytes,
			handle,
		)
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

func runToolCommand(
	ctx context.Context,
	command string,
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

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(executionCtx, "cmd", "/C", command)
	} else {
		cmd = exec.CommandContext(executionCtx, "sh", "-c", command)
	}
	cmd.SysProcAttr = newSysProcAttr()
	cmd.Env = setupCmdEnv(toolPath)
	cmd.Cancel = func() error { return killCommand(cmd) }
	cmd.Stdout = stdout
	cmd.Stderr = stderr

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
