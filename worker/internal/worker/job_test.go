package worker

import (
	"context"
	"errors"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/sil3ntcor3/open-asm/grpc-client/go/jobs_registry"
)

func TestRunToolCommandClassifiesExecutionOutcomes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix command fixtures are exercised by the Linux worker build")
	}

	tests := []struct {
		name            string
		command         string
		timeout         time.Duration
		outputLimit     int64
		wantOutcome     executionOutcome
		wantExitCode    int32
		wantStdout      string
		wantStderr      string
		wantOutputLimit bool
	}{
		{
			name:         "successful exit",
			command:      "printf stdout; printf stderr >&2",
			timeout:      time.Second,
			outputLimit:  1024,
			wantOutcome:  executionOutcomeSucceeded,
			wantExitCode: 0,
			wantStdout:   "stdout",
			wantStderr:   "stderr",
		},
		{
			name:         "nonzero exit",
			command:      "printf partial; printf failure >&2; exit 1",
			timeout:      time.Second,
			outputLimit:  1024,
			wantOutcome:  executionOutcomeFailed,
			wantExitCode: 1,
			wantStdout:   "partial",
			wantStderr:   "failure",
		},
		{
			name:         "missing binary",
			command:      "oasm-command-that-does-not-exist",
			timeout:      time.Second,
			outputLimit:  1024,
			wantOutcome:  executionOutcomeFailed,
			wantExitCode: 127,
		},
		{
			name:        "deadline",
			command:     "sleep 2",
			timeout:     10 * time.Millisecond,
			outputLimit: 1024,
			wantOutcome: executionOutcomeTimedOut,
		},
		{
			name:            "output limit",
			command:         "printf 123456789",
			timeout:         time.Second,
			outputLimit:     4,
			wantOutcome:     executionOutcomeOutputLimited,
			wantStdout:      "1234",
			wantOutputLimit: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := runToolCommand(
				context.Background(),
				test.command,
				"",
				test.timeout,
				test.outputLimit,
				test.outputLimit,
				nil,
			)

			if result.outcome != test.wantOutcome {
				t.Fatalf("outcome = %q, want %q", result.outcome, test.wantOutcome)
			}
			if test.wantExitCode != 0 && result.exitCode != test.wantExitCode {
				t.Fatalf("exit code = %d, want %d", result.exitCode, test.wantExitCode)
			}
			if !strings.Contains(result.stdout, test.wantStdout) {
				t.Fatalf("stdout = %q, want it to contain %q", result.stdout, test.wantStdout)
			}
			if !strings.Contains(result.stderr, test.wantStderr) {
				t.Fatalf("stderr = %q, want it to contain %q", result.stderr, test.wantStderr)
			}
			if result.outputLimited != test.wantOutputLimit {
				t.Fatalf("outputLimited = %v, want %v", result.outputLimited, test.wantOutputLimit)
			}
		})
	}
}

func TestRunToolCommandClassifiesCancellation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix command fixtures are exercised by the Linux worker build")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	result := runToolCommand(ctx, "sleep 1", "", time.Second, 1024, 1024, nil)

	if result.outcome != executionOutcomeCanceled {
		t.Fatalf("outcome = %q, want %q", result.outcome, executionOutcomeCanceled)
	}
}

func TestScreenshotPayloadReportsCaptureFailure(t *testing.T) {
	payload := screenshotPayload("example.com", "", errors.New("capture failed"))

	if !payload.GetError() {
		t.Fatal("screenshot failure was reported as success")
	}
	if payload.GetOutcome() != jobs_registry.ExecutionOutcome_EXECUTION_OUTCOME_FAILED {
		t.Fatalf("outcome = %q, want failed", payload.GetOutcome())
	}
}
