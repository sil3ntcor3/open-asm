package oasm

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifyToolArtifactDigestRejectsTamperedTransfer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "artifact.zip")
	original := []byte("verified archive")
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	digest := fmt.Sprintf("%x", sha256.Sum256(original))
	if err := verifyToolArtifactDigest(path, digest+".zip"); err != nil {
		t.Fatalf("valid artifact rejected: %v", err)
	}
	if err := os.WriteFile(path, []byte("tampered archive"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyToolArtifactDigest(path, digest+".zip"); err == nil || !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("tampered artifact error = %v, want digest mismatch", err)
	}
}

func TestActivateStagedToolFilesRollsBackPartialPromotion(t *testing.T) {
	destination := t.TempDir()
	staging := t.TempDir()
	for _, name := range []string{"one", "two"} {
		if err := os.WriteFile(filepath.Join(destination, name), []byte("old-"+name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(staging, "one"), []byte("new-one"), 0o755); err != nil {
		t.Fatal(err)
	}

	err := activateStagedToolFiles(staging, destination, []string{"one", "two"})
	if err == nil {
		t.Fatal("activation unexpectedly succeeded with a missing staged file")
	}
	for _, name := range []string{"one", "two"} {
		contents, readErr := os.ReadFile(filepath.Join(destination, name))
		if readErr != nil || string(contents) != "old-"+name {
			t.Fatalf("live %s after rollback = %q, %v", name, contents, readErr)
		}
	}
}
