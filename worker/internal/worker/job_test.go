package worker

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
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

func TestBuildSubfinderInvocationUsesAllSources(t *testing.T) {
	t.Setenv("SUBFINDER_PROVIDER_CONFIG", "")
	invocation, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "subfinder",
		Target:   "example.com",
	})
	if err != nil {
		t.Fatal(err)
	}

	if !hasArgument(invocation.args, "-all") {
		t.Fatalf("subfinder args = %q, want -all to enable every available source", invocation.args)
	}
}

func TestBuildSubfinderInvocationUsesConfiguredProviderKeys(t *testing.T) {
	providerConfig := "/run/secrets/subfinder-provider-config.yaml"
	t.Setenv("SUBFINDER_PROVIDER_CONFIG", providerConfig)

	invocation, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "subfinder",
		Target:   "example.com",
	})
	if err != nil {
		t.Fatal(err)
	}

	if got := argumentValue(t, invocation.args, "-pc"); got != providerConfig {
		t.Fatalf("subfinder provider config = %q, want %q", got, providerConfig)
	}
}

func TestRunSubfinderDoesNotForwardProviderDiagnostics(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is exercised by Unix worker builds")
	}

	const providerSecret = "sentinel-provider-secret"
	for _, testCase := range []struct {
		name        string
		exitCommand string
		wantOutcome executionOutcome
	}{
		{name: "failed command", exitCommand: "exit 1\n", wantOutcome: executionOutcomeFailed},
		{name: "successful command", exitCommand: "exit 0\n", wantOutcome: executionOutcomeSucceeded},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			toolPath := t.TempDir()
			subfinderPath := filepath.Join(toolPath, "subfinder")
			if err := os.WriteFile(
				subfinderPath,
				[]byte("#!/bin/sh\nprintf 'sub.example.com\\n'\nprintf 'request failed: https://provider.invalid/?key="+providerSecret+"\\n' >&2\n"+testCase.exitCommand),
				0o700,
			); err != nil {
				t.Fatal(err)
			}

			if testCase.wantOutcome == executionOutcomeSucceeded {
				dnsxPath := filepath.Join(toolPath, "dnsx")
				if err := os.WriteFile(
					dnsxPath,
					[]byte("#!/bin/sh\ncat >/dev/null\nprintf 'sub.example.com [A] [192.0.2.1]\\n'\n"),
					0o700,
				); err != nil {
					t.Fatal(err)
				}
			}

			result := runToolExecution(
				context.Background(),
				&jobs_registry.ToolExecution{ToolName: "subfinder", Target: "example.com"},
				toolPath,
				time.Second,
				1024,
				1024,
				nil,
			)

			if result.outcome != testCase.wantOutcome {
				t.Fatalf("outcome = %q, want %q", result.outcome, testCase.wantOutcome)
			}
			if strings.Contains(result.stderr, providerSecret) {
				t.Fatalf("subfinder stderr exposed provider secret: %q", result.stderr)
			}
			if !strings.Contains(result.stderr, "suppressed") {
				t.Fatalf("subfinder stderr = %q, want a safe suppression notice", result.stderr)
			}
		})
	}
}

func TestBuildHttpxInvocationProbesServiceDirectlyWithoutFollowingRedirects(t *testing.T) {
	// Each asset_service is a distinct (host, port) discovered by naabu, and httpx
	// probes it individually. Following redirects makes httpx chase the request to
	// a *different* endpoint (e.g. http://host:80 -> https://host:443) and report
	// that other endpoint's outcome under this service. When the redirect target's
	// TLS is broken the whole probe is flagged failed=true / status_code=0, wiping
	// the real response for this port even though the port answered. Redirect
	// targets are separate services that naabu also finds and httpx probes on their
	// own, so this probe must describe only the endpoint it was given.
	invocation, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "httpx",
		Target:   "fralan.com:80",
	})
	if err != nil {
		t.Fatal(err)
	}

	if hasArgument(invocation.args, "-follow-redirects") {
		t.Fatalf("httpx args = %q, want no -follow-redirects (per-service probe must not chase cross-endpoint redirects)", invocation.args)
	}

	// Port 80 carries an explicit scheme so httpx cannot renormalise the input
	// onto a different port — see TestHttpxProbeTargetPinsDefaultPortsToAScheme.
	if got := argumentValue(t, invocation.args, "-u"); got != "http://fralan.com:80" {
		t.Fatalf("httpx target = %q, want %q", got, "http://fralan.com:80")
	}

	// The probe must still capture the signals the Assets page renders.
	for _, required := range []string{"-probe", "-json", "-status-code", "-tech-detect", "-tls-grab", "-web-server", "-ip"} {
		if !hasArgument(invocation.args, required) {
			t.Fatalf("httpx args = %q, missing required flag %q", invocation.args, required)
		}
	}
}

func TestHttpxProbeTargetPinsDefaultPortsToAScheme(t *testing.T) {
	// Given a scheme-less "host:443", httpx treats 443 as the https default,
	// reduces the input to "https://host", and on failure falls back to
	// "http://host" — port 80. It then files port 80's response under the :443
	// service. An explicit scheme removes the normalisation that causes it.
	for _, testCase := range []struct {
		name   string
		target string
		port   int
		want   string
	}{
		{"https default port", "example.com:443", 443, "https://example.com:443"},
		{"http default port", "example.com:80", 80, "http://example.com:80"},
		{"port derived from target when plan omits it", "example.com:443", 0, "https://example.com:443"},
		{"non-default port keeps httpx fallback", "example.com:8443", 8443, "example.com:8443"},
		{"non-default port 8080 untouched", "example.com:8080", 8080, "example.com:8080"},
		{"existing scheme preserved", "https://example.com:443", 443, "https://example.com:443"},
		{"bare host untouched", "example.com", 0, "example.com"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := httpxProbeTarget(testCase.target, testCase.port); got != testCase.want {
				t.Fatalf("httpxProbeTarget(%q, %d) = %q, want %q",
					testCase.target, testCase.port, got, testCase.want)
			}
		})
	}
}

func TestBuildHttpxInvocationUsesHttpsForPort443(t *testing.T) {
	httpsPort := int32(443)
	invocation, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "httpx",
		Target:   "fralan.com:443",
		Port:     &httpsPort,
	})
	if err != nil {
		t.Fatal(err)
	}

	if got := argumentValue(t, invocation.args, "-u"); got != "https://fralan.com:443" {
		t.Fatalf("httpx target = %q, want %q (a :443 probe must not fall back to port 80)",
			got, "https://fralan.com:443")
	}
}

func TestBuildNaabuInvocationUsesCalmerScanRate(t *testing.T) {
	// The naabu SYN burst is the primary trigger for target-side scan detection,
	// which then filters nmap/httpx for the rest of the storm and strands the
	// screenshot/nuclei steps. Keep the rate well below naabu's 1000 default (and
	// below the 500 that still tripped pentest-ground.com) so the scan stays under
	// common detection thresholds. The pipeline's resilience fixes handle blocks
	// that still slip through; this just makes them rarer.
	inv, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "naabu",
		Target:   "example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	rate := argumentValue(t, inv.args, "-rate")
	n, convErr := strconv.Atoi(rate)
	if convErr != nil {
		t.Fatalf("naabu -rate = %q, want an integer", rate)
	}
	if n <= 0 || n > 250 {
		t.Fatalf("naabu -rate = %d, want a calmer rate in (0, 250]", n)
	}
}

func TestBuildNmapInvocationSplitsHostAndPort(t *testing.T) {
	port := int32(443)
	inv, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "nmap",
		Target:   "frazerlanier.com:443",
		Port:     &port,
	})
	if err != nil {
		t.Fatal(err)
	}
	if inv.executable != "nmap" {
		t.Fatalf("executable = %q, want nmap (system package, not oasm-tools)", inv.executable)
	}
	joined := strings.Join(inv.args, " ")
	for _, want := range []string{"-sV", "-p 443"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("nmap args %q missing %q", joined, want)
		}
	}
	if last := inv.args[len(inv.args)-1]; last != "frazerlanier.com" {
		t.Fatalf("nmap host = %q, want frazerlanier.com (port stripped from target)", last)
	}
}

func TestBuildNmapInvocationFallsBackToTargetPort(t *testing.T) {
	// No typed Port on the execution: the port must be recovered from the
	// "host:port" target so odd-port web services are still probed correctly.
	inv, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "nmap",
		Target:   "example.com:8443",
	})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(inv.args, " ")
	if !strings.Contains(joined, "-p 8443") {
		t.Fatalf("nmap args %q want -p 8443 recovered from target", joined)
	}
	if last := inv.args[len(inv.args)-1]; last != "example.com" {
		t.Fatalf("nmap host = %q, want example.com", last)
	}
}

func TestBuildNmapInvocationRequiresPort(t *testing.T) {
	_, err := buildToolInvocation("/scanner-tools", &jobs_registry.ToolExecution{
		ToolName: "nmap",
		Target:   "example.com",
	})
	if err == nil {
		t.Fatal("nmap service discovery must error without a port")
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
	// Helper and payload files are only loadable from Nuclei's configured
	// template directory, so scans must anchor it at the set being scanned.
	if got := argumentValue(t, invocation.args, "-ud"); got != candidatePath {
		t.Fatalf("template directory = %q, want the scanned set %q", got, candidatePath)
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
