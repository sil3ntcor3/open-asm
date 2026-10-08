package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strings"

	"github.com/go-rod/rod"
	"github.com/oasm-platform/oasm-sdk-go/oasm"
	"github.com/oasm-platform/open-asm/grpc-client/go/jobs_registry"
)

var jobLogGlobal = oasm.NewLogger("Worker.Job")

func processJob(ctx context.Context, client *oasm.Client, browser *rod.Browser, toolPath string) {
	job, err := client.JobsNext(ctx)
	if err != nil {
		jobLogGlobal.ErrorE("Failed to pull job", err)
		return
	}
	if job == nil || job.Id == "" {
		return
	}

	// jobCtx is the per-job control scope: an operator STOP directive (or
	// worker shutdown via the parent ctx) cancels it, which kills the scan
	// process group through the command's Cancel hook.
	jobCtx, cancelJob := context.WithCancel(ctx)
	defer cancelJob()

	handle := &jobHandle{id: job.Id, cancel: cancelJob}
	activeJobs.add(handle)
	defer activeJobs.remove(job.Id)

	cmdStr := job.GetCommand()
	if cmdStr == "" {
		jobLogGlobal.Warning("[%s] Empty command", job.Id)
		_ = client.JobsResult(ctx, job.Id, oasm.NewErrorResult("No command provided by Core"))
		return
	}

	jobLogGlobal.Info("[%s] Executing: %s", job.Id, cmdStr)
	var payload *jobs_registry.DataPayloadResult

	if after, ok := strings.CutPrefix(cmdStr, "screenshot "); ok {
		url := strings.TrimSpace(after)
		jobLogGlobal.Debug("[%s] Capturing screenshot: %s", job.Id, url)

		base64Image, err := TakeScreenshotBase64(jobCtx, browser, url)
		if err != nil {
			jobLogGlobal.Warning("[%s] Screenshot capture failed: %v", job.Id, err)
		}
		resultData := struct {
			Screenshot string `json:"screenshot"`
			URL        string `json:"url"`
		}{
			Screenshot: base64Image,
			URL:        formatURL(url),
		}

		if jsonBytes, err := json.Marshal(resultData); err != nil {
			jobLogGlobal.ErrorE(fmt.Sprintf("[%s] JSON marshal failed", job.Id), err)
			payload = oasm.NewErrorResult(fmt.Sprintf("JSON error: %v", err))
		} else {
			jsonStr := string(jsonBytes)
			payload = &jobs_registry.DataPayloadResult{
				Error: false,
				Raw:   &jsonStr,
			}
		}
	} else {
		var cmd *exec.Cmd
		if runtime.GOOS == "windows" {
			cmd = exec.CommandContext(jobCtx, "cmd", "/C", cmdStr)
		} else {
			cmd = exec.CommandContext(jobCtx, "sh", "-c", cmdStr)
		}
		cmd.SysProcAttr = newSysProcAttr()
		cmd.Env = setupCmdEnv(toolPath)
		// Kill the whole process group on cancellation, not just the shell:
		// scan tools spawned by `sh -c` would otherwise keep running after a
		// stop directive or shutdown.
		cmd.Cancel = func() error { return killCommand(cmd) }

		var output bytes.Buffer
		cmd.Stdout = &output
		cmd.Stderr = &output

		if startErr := cmd.Start(); startErr != nil {
			err = startErr
		} else {
			// Expose the process group to the control loop for diagnostics and
			// platform-specific cancellation helpers.
			handle.setPid(cmd.Process.Pid)
			err = cmd.Wait()
		}
		outStr := output.String()

		// If the job context was cancelled the process was killed mid-scan
		// (worker shutdown, or an operator stop signal). Reporting a killed
		// scan as a successful completion would persist partial/empty output as
		// the authoritative result and mark the asset "clean" — a dangerous
		// false negative for attack-surface monitoring. Flag it as an error so
		// Core re-queues the job instead of recording it as done. (For
		// operator-cancelled jobs Core drops the result entirely.)
		if ctxErr := jobCtx.Err(); ctxErr != nil {
			jobLogGlobal.Warning("[%s] Aborted before completion: %v", job.Id, ctxErr)
			payload = oasm.NewErrorResult(fmt.Sprintf("job aborted before completion: %v", ctxErr))
		} else {
			if err != nil {
				jobLogGlobal.Verbose("[%s] Process exited with error: %v", job.Id, err)
			}
			payload = &jobs_registry.DataPayloadResult{
				Error: false,
				Raw:   &outStr,
			}
		}
	}

	// Submit with the session ctx (not jobCtx): a stopped job's abort report
	// must still reach Core even though its own context is cancelled.
	if err := client.JobsResult(ctx, job.Id, payload); err != nil {
		jobLogGlobal.ErrorE(fmt.Sprintf("[%s] Failed to submit result", job.Id), err)
		return
	}

	jobLogGlobal.Success("[%s] Completed", job.Id)
}
