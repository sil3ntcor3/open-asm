package worker

import (
	"context"
	"errors"
	"os"
	"path/filepath"
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
		invocation      toolInvocation
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
			invocation:   toolInvocation{executable: "sh", args: []string{"-c", "printf stdout; printf stderr >&2"}},
			timeout:      time.Second,
			outputLimit:  1024,
			wantOutcome:  executionOutcomeSucceeded,
			wantExitCode: 0,
			wantStdout:   "stdout",
			wantStderr:   "stderr",
		},
		{
			name:         "nonzero exit",
			invocation:   toolInvocation{executable: "sh", args: []string{"-c", "printf partial; printf failure >&2; exit 1"}},
			timeout:      time.Second,
			outputLimit:  1024,
			wantOutcome:  executionOutcomeFailed,
			wantExitCode: 1,
			wantStdout:   "partial",
			wantStderr:   "failure",
		},
		{
			name:         "missing binary",
			invocation:   toolInvocation{executable: "oasm-command-that-does-not-exist"},
			timeout:      time.Second,
			outputLimit:  1024,
			wantOutcome:  executionOutcomeStartFailed,
			wantExitCode: -1,
		},
		{
			name:         "deadline",
			invocation:   toolInvocation{executable: "sleep", args: []string{"2"}},
			timeout:      10 * time.Millisecond,
			outputLimit:  1024,
			wantOutcome:  executionOutcomeTimedOut,
			wantExitCode: -1,
		},
		{
			name:            "output limit",
			invocation:      toolInvocation{executable: "printf", args: []string{"123456789"}},
			timeout:         time.Second,
			outputLimit:     4,
			wantOutcome:     executionOutcomeOutputLimited,
			wantStdout:      "1234",
			wantOutputLimit: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := runDirectCommand(
				context.Background(),
				test.invocation,
				"",
				test.timeout,
				test.outputLimit,
				test.outputLimit,
				nil,
			)

			if result.outcome != test.wantOutcome {
				t.Fatalf("outcome = %q, want %q", result.outcome, test.wantOutcome)
			}
			if result.exitCode != test.wantExitCode {
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

	result := runDirectCommand(
		ctx,
		toolInvocation{executable: "sleep", args: []string{"1"}},
		"",
		time.Second,
		1024,
		1024,
		nil,
	)

	if result.outcome != executionOutcomeCanceled {
		t.Fatalf("outcome = %q, want %q", result.outcome, executionOutcomeCanceled)
	}
}

func TestRunToolCommandUsesToolDirectoryAsWorkingDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix command fixtures are exercised by the Linux worker build")
	}

	toolPath := t.TempDir()
	result := runDirectCommand(
		context.Background(),
		toolInvocation{executable: "pwd"},
		toolPath,
		time.Second,
		1024,
		1024,
		nil,
	)

	if result.outcome != executionOutcomeSucceeded {
		t.Fatalf("outcome = %q, want %q: %s", result.outcome, executionOutcomeSucceeded, result.stderr)
	}
	got := strings.TrimSpace(result.stdout)
	gotInfo, gotErr := os.Stat(got)
	wantInfo, wantErr := os.Stat(toolPath)
	if gotErr != nil || wantErr != nil || !os.SameFile(gotInfo, wantInfo) {
		t.Fatalf("working directory = %q, want %q", got, toolPath)
	}
}

func TestBuildToolInvocationKeepsTargetMetacharactersInOneArgument(t *testing.T) {
	target := "https://example.com/?x=1;touch /tmp/pwn&y=$(id)"
	invocation, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "naabu",
		Target:   target,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(invocation.args) < 2 || invocation.args[0] != "-host" || invocation.args[1] != target {
		t.Fatalf("target argument vector = %q, want target preserved as one argument", invocation.args)
	}
}

func TestBuildToolInvocationRejectsUnknownTool(t *testing.T) {
	_, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "arbitrary-shell",
		Target:   "example.com",
	})
	if err == nil || !strings.Contains(err.Error(), "not allowlisted") {
		t.Fatalf("error = %v, want allowlist rejection", err)
	}
}

func TestBuildNucleiInvocationResolvesImmutableTemplateVersion(t *testing.T) {
	toolPath := t.TempDir()
	candidatePath := filepath.Join(toolPath, nucleiTemplatesVersionPrefix+"10.4.6-test")
	if err := os.MkdirAll(filepath.Join(candidatePath, "http"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(candidatePath, "http", "test.yaml"), []byte("id: test"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(candidatePath, nucleiTemplatesReadyFile), []byte("v10.4.6\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := publishNucleiTemplatesPointer(toolPath, candidatePath); err != nil {
		t.Fatal(err)
	}

	invocation, err := buildToolInvocation(toolPath, &jobs_registry.ToolExecution{
		ToolName: "nuclei",
		Target:   "https://example.com/?x=1;touch /tmp/pwn",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := argumentValue(t, invocation.args, "-t"); got != candidatePath {
		t.Fatalf("template path = %q, want %q", got, candidatePath)
	}
}

func TestDnsxWildcardFilterInvocationDropsWildcardNoise(t *testing.T) {
	inv := dnsxWildcardFilterInvocation("/scanner-tools", "frazan.com", "mail.frazan.com\nmx.mx.mx.frazan.com\n")

	if got := argumentValue(t, inv.args, "-wd"); got != "frazan.com" {
		t.Fatalf("-wd = %q, want the apex domain frazan.com", got)
	}
	if !containsArg(inv.args, "-silent") {
		t.Fatalf("wildcard filter args = %q, want -silent (hostname-only output)", inv.args)
	}
	for _, banned := range []string{"-resp", "-a", "-mx"} {
		if containsArg(inv.args, banned) {
			t.Fatalf("wildcard filter args = %q, must not request record types (ignored by -wd)", inv.args)
		}
	}
	if want := "frazan.com\nmail.frazan.com\nmx.mx.mx.frazan.com\n"; inv.stdin != want {
		t.Fatalf("stdin = %q, want the apex prepended to the subfinder output %q", inv.stdin, want)
	}
}

func TestDnsxEnrichInvocationAlwaysIncludesApex(t *testing.T) {
	inv := dnsxEnrichInvocation("/scanner-tools", "frazan.com", "")

	for _, want := range []string{"-a", "-aaaa", "-cname", "-mx", "-ns", "-soa", "-txt", "-resp"} {
		if !containsArg(inv.args, want) {
			t.Fatalf("enrich args = %q, want it to request %q for the Core parser", inv.args, want)
		}
	}
	if inv.stdin != "frazan.com\n" {
		t.Fatalf("stdin = %q, want the apex enriched even with no filtered hosts", inv.stdin)
	}
}

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
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
