package worker

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestValidateToolUpdateDirectiveAcceptsOnlyOfficialExactReleaseAsset(t *testing.T) {
	directive := testToolUpdateDirective(t, "httpx", "1.10.0", nil)

	if err := validateToolUpdateDirective(directive, runtime.GOOS, runtime.GOARCH); err != nil {
		t.Fatalf("validateToolUpdateDirective() error = %v", err)
	}

	directive.artifactURL = "https://example.com/httpx.zip"
	if err := validateToolUpdateDirective(directive, runtime.GOOS, runtime.GOARCH); err == nil {
		t.Fatal("untrusted release URL was accepted")
	}
}

func TestApplyArtifactToolUpdateRejectsDigestMismatchWithoutReplacingBinary(t *testing.T) {
	toolPath := t.TempDir()
	writeTestToolBinary(t, toolPath, "httpx", "1.9.0")
	archive := testToolArchive(t, "httpx", "1.10.0")
	directive := testToolUpdateDirective(t, "httpx", "1.10.0", archive)
	directive.sha256 = strings.Repeat("0", 64)

	_, _, err := applyArtifactToolUpdate(
		context.Background(),
		toolPath,
		directive,
		runtime.GOOS,
		runtime.GOARCH,
		func(context.Context, string) ([]byte, error) { return archive, nil },
		testToolVersionRunner,
	)
	if err == nil || !strings.Contains(err.Error(), "digest") {
		t.Fatalf("applyArtifactToolUpdate() error = %v, want digest failure", err)
	}
	assertTestToolVersion(t, toolPath, "httpx", "1.9.0")
}

func TestApplyArtifactToolUpdateActivatesVerifiedBinaryAndReportsRollbackVersion(t *testing.T) {
	toolPath := t.TempDir()
	writeTestToolBinary(t, toolPath, "httpx", "1.9.0")
	archive := testToolArchive(t, "httpx", "1.10.0")
	directive := testToolUpdateDirective(t, "httpx", "1.10.0", archive)

	installed, rollback, err := applyArtifactToolUpdate(
		context.Background(),
		toolPath,
		directive,
		runtime.GOOS,
		runtime.GOARCH,
		func(context.Context, string) ([]byte, error) { return archive, nil },
		testToolVersionRunner,
	)
	if err != nil {
		t.Fatalf("applyArtifactToolUpdate() error = %v", err)
	}
	if installed != "1.10.0" || rollback != "1.9.0" {
		t.Fatalf("versions = installed %q rollback %q", installed, rollback)
	}
	assertTestToolVersion(t, toolPath, "httpx", "1.10.0")
}

func TestApplyArtifactToolUpdateRollsBackWhenPostActivationSmokeTestFails(t *testing.T) {
	toolPath := t.TempDir()
	writeTestToolBinary(t, toolPath, "httpx", "1.9.0")
	archive := testToolArchive(t, "httpx", "1.10.0")
	directive := testToolUpdateDirective(t, "httpx", "1.10.0", archive)
	newVersionChecks := 0
	run := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		output, err := testToolVersionRunner(ctx, name, args...)
		if strings.Contains(string(output), "1.10.0") {
			newVersionChecks++
			if newVersionChecks == 2 {
				return output, errors.New("post-activation failure")
			}
		}
		return output, err
	}

	_, rollback, err := applyArtifactToolUpdate(
		context.Background(),
		toolPath,
		directive,
		runtime.GOOS,
		runtime.GOARCH,
		func(context.Context, string) ([]byte, error) { return archive, nil },
		run,
	)
	if err == nil || rollback != "1.9.0" {
		t.Fatalf("error = %v rollback = %q, want activation failure and 1.9.0", err, rollback)
	}
	assertTestToolVersion(t, toolPath, "httpx", "1.9.0")
}

func TestReadRuntimeToolVersionSupportsWorkerImageVersionFormats(t *testing.T) {
	tests := []struct {
		output string
		want   string
	}{
		{output: "Nmap version 7.93 ( https://nmap.org )", want: "7.93"},
		{output: "Chromium 151.0.7777.129", want: "151.0.7777.129"},
	}
	for _, test := range tests {
		run := func(context.Context, string, ...string) ([]byte, error) {
			return []byte(test.output), nil
		}
		got, err := readRuntimeToolVersion(context.Background(), "runtime", []string{"--version"}, run)
		if err != nil || got != test.want {
			t.Fatalf("readRuntimeToolVersion(%q) = %q, %v; want %q", test.output, got, err, test.want)
		}
	}
}

func testToolUpdateDirective(t *testing.T, component string, version string, archive []byte) toolUpdateDirective {
	t.Helper()
	platformOS := runtime.GOOS
	if platformOS == "darwin" {
		platformOS = "macOS"
	}
	assetName := fmt.Sprintf("%s_%s_%s_%s.zip", component, version, platformOS, runtime.GOARCH)
	digest := sha256.Sum256(archive)
	return toolUpdateDirective{
		requestID:     "1f0999d1-63c0-4f34-9d8e-fe94d625f909",
		component:     component,
		targetVersion: version,
		kind:          "artifact",
		artifactName:  assetName,
		artifactURL: fmt.Sprintf(
			"https://github.com/projectdiscovery/%s/releases/download/v%s/%s",
			component,
			version,
			assetName,
		),
		sha256: fmt.Sprintf("%x", digest),
	}
}

func testToolArchive(t *testing.T, component string, version string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	entry, err := archive.Create(component)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("version=" + version)); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func writeTestToolBinary(t *testing.T, toolPath string, component string, version string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(toolPath, component), []byte("version="+version), 0o755); err != nil {
		t.Fatal(err)
	}
}

func assertTestToolVersion(t *testing.T, toolPath string, component string, version string) {
	t.Helper()
	contents, err := os.ReadFile(filepath.Join(toolPath, component))
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "version="+version {
		t.Fatalf("tool contents = %q, want version=%s", contents, version)
	}
}

func testToolVersionRunner(_ context.Context, name string, _ ...string) ([]byte, error) {
	contents, err := os.ReadFile(name)
	if err != nil {
		return nil, err
	}
	version := strings.TrimPrefix(string(contents), "version=")
	return []byte("Current Version: v" + version), nil
}
