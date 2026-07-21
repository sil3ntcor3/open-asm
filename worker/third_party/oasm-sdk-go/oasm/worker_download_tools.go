package oasm

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	pb "github.com/sil3ntcor3/open-asm/grpc-client/go/workers"
)

const toolCacheLockDirectoryName = ".oasm-tools-sync.lock"

func (c *Client) WorkerDownloadTools(ctx context.Context) error {
	l := NewLogger("Worker.Sync")

	absToolPath, err := filepath.Abs(c.toolPath)
	if err != nil {
		l.ErrorE("Failed to resolve absolute tool path", err)
		return err
	}

	statePath := filepath.Join(absToolPath, ".tool_versions.json")

	if err := os.MkdirAll(absToolPath, 0o755); err != nil {
		return fmt.Errorf("failed to create tool directory: %w", err)
	}

	osKey := runtime.GOOS
	if osKey == "darwin" {
		osKey = "macos"
	}

	archKey := runtime.GOARCH

	registry, err := c.Workers().BuiltinToolRegistry(ctx, &pb.BuiltinToolRegistryRequest{Os: osKey, Arch: archKey})
	if err != nil {
		l.ErrorE("BuiltinToolRegistry retrieval failed", err)
		return err
	}

	oldState := loadToolState(statePath)
	newState := make(map[string][]string)

	for _, toolUrl := range registry.ToolPaths {
		fileName := filepath.Base(toolUrl)

		if extractedFiles, exists := oldState[fileName]; exists && cachedToolFilesReady(absToolPath, extractedFiles) {
			l.Success("Tools cache hit: %s", fileName)
			newState[fileName] = extractedFiles
			continue
		}

		l.Info("Downloading tool: %s", fileName)
		extractedFiles, err := c.downloadAndExtractSingleTool(ctx, toolUrl, absToolPath, fileName)
		if err != nil {
			l.ErrorE("Failed to download/extract tool", err, fileName)
			return err
		}

		newState[fileName] = extractedFiles
	}

	activeFiles := make(map[string]bool)
	for _, files := range newState {
		for _, f := range files {
			activeFiles[f] = true
		}
	}

	for oldFileName, oldExtractedFiles := range oldState {
		if _, stillExists := newState[oldFileName]; !stillExists {
			l.Info("Cleaning up obsolete tool: %s", oldFileName)
			for _, file := range oldExtractedFiles {
				if !activeFiles[file] {
					fullPath := filepath.Join(absToolPath, file)
					_ = os.Remove(fullPath)
					l.Verbose("Deleted unused file: %s", file)
				}
			}
		}
	}

	if err := saveToolState(statePath, newState); err != nil {
		l.ErrorE("Failed to save tool state", err)
	}

	manifest, err := c.Workers().GetManifest(ctx, &pb.GetManifestRequest{})
	if err != nil {
		l.ErrorE("Failed to retrieve GetManifest for init commands", err)
	} else if len(manifest.InitCommands) > 0 {
		l.Info("Executing %d initialization commands", len(manifest.InitCommands))
		for _, cmdStr := range manifest.InitCommands {
			if err := c.runInitCommand(ctx, cmdStr, absToolPath); err != nil {
				l.ErrorE("Init command failed", err, cmdStr)
				return err
			}
		}
		l.Success("All init commands executed successfully")
	} else {
		l.Debug("GetManifest success, but no init commands to execute")
	}

	return nil
}

func cachedToolFilesReady(toolPath string, files []string) bool {
	if len(files) == 0 {
		return false
	}
	for _, relativePath := range files {
		path, err := safeToolPath(toolPath, relativePath)
		if err != nil {
			return false
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}

func (c *Client) downloadAndExtractSingleTool(ctx context.Context, url string, destDir string, fileName string) ([]string, error) {
	dlLog := NewLogger("Worker.Download")

	stream, err := c.Workers().Storage(ctx, &pb.StorageRequest{Path: url})
	if err != nil {
		return nil, fmt.Errorf("failed to start download stream: %w", err)
	}

	downloadDir, err := os.MkdirTemp(destDir, ".oasm-tool-download-")
	if err != nil {
		return nil, fmt.Errorf("failed to create download staging directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(downloadDir) }()
	tempFile := filepath.Join(downloadDir, fileName)
	file, err := os.OpenFile(tempFile, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("failed to create temporary file: %w", err)
	}

	for {
		resp, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			_ = file.Close()
			return nil, fmt.Errorf("error receiving stream: %w", err)
		}
		if _, err = file.WriteAt(resp.Chunk, int64(resp.Offset)); err != nil {
			_ = file.Close()
			return nil, fmt.Errorf("failed to write chunk: %w", err)
		}
		if resp.Eof {
			break
		}
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("failed to sync downloaded artifact: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("failed to close downloaded artifact: %w", err)
	}
	if err := verifyToolArtifactDigest(tempFile, fileName); err != nil {
		return nil, err
	}
	dlLog.Success("Download completed: %s", tempFile)

	extLog := NewLogger("Worker.Extract")
	extLog.Info("Extracting %s...", fileName)
	stagingDir, err := os.MkdirTemp(destDir, ".oasm-tool-stage-")
	if err != nil {
		return nil, fmt.Errorf("failed to create extraction staging directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(stagingDir) }()

	var extractedFiles []string
	if strings.HasSuffix(fileName, ".zip") {
		extractedFiles, err = c.extractZip(tempFile, stagingDir, extLog)
	} else if strings.HasSuffix(fileName, ".tar.gz") || strings.HasSuffix(fileName, ".tgz") {
		extractedFiles, err = c.extractTarGz(tempFile, stagingDir, extLog)
	} else {
		return nil, fmt.Errorf("unsupported archive format: %s", fileName)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to extract and set permissions: %w", err)
	}
	if err := smokeTestStagedTools(ctx, stagingDir, extractedFiles); err != nil {
		return nil, err
	}
	if err := activateStagedToolFiles(stagingDir, destDir, extractedFiles); err != nil {
		return nil, err
	}

	return extractedFiles, nil
}

func verifyToolArtifactDigest(path string, artifactID string) error {
	if len(artifactID) < sha256.Size*2 {
		return errors.New("tool artifact ID does not contain a SHA-256 digest")
	}
	expected := strings.ToLower(artifactID[:sha256.Size*2])
	for _, character := range expected {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return errors.New("tool artifact ID contains an invalid SHA-256 digest")
		}
	}
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open downloaded tool artifact for verification: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return fmt.Errorf("hash downloaded tool artifact: %w", err)
	}
	actual := fmt.Sprintf("%x", hash.Sum(nil))
	if actual != expected {
		return fmt.Errorf("tool artifact SHA-256 mismatch: expected %s, got %s", expected, actual)
	}
	return nil
}

func smokeTestStagedTools(ctx context.Context, stagingDir string, files []string) error {
	for _, relativePath := range files {
		baseName := filepath.Base(relativePath)
		if strings.Contains(baseName, ".") && !strings.HasSuffix(strings.ToLower(baseName), ".exe") {
			continue
		}
		binaryPath, err := safeToolPath(stagingDir, relativePath)
		if err != nil {
			return err
		}
		command := exec.CommandContext(ctx, binaryPath, "-version")
		output, runErr := command.CombinedOutput()
		if runErr != nil {
			return fmt.Errorf("smoke-test staged tool %s: %w: %s", relativePath, runErr, strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func activateStagedToolFiles(stagingDir string, destDir string, files []string) error {
	backupDir, err := os.MkdirTemp(destDir, ".oasm-tool-backup-")
	if err != nil {
		return fmt.Errorf("create tool rollback directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(backupDir) }()

	type promotedFile struct {
		relativePath string
		hadBackup    bool
	}
	promoted := make([]promotedFile, 0, len(files))
	rollback := func() {
		for index := len(promoted) - 1; index >= 0; index-- {
			entry := promoted[index]
			livePath, liveErr := safeToolPath(destDir, entry.relativePath)
			backupPath, backupErr := safeToolPath(backupDir, entry.relativePath)
			if liveErr != nil || backupErr != nil {
				continue
			}
			_ = os.RemoveAll(livePath)
			if entry.hadBackup {
				_ = os.MkdirAll(filepath.Dir(livePath), 0o755)
				_ = os.Rename(backupPath, livePath)
			}
		}
	}

	for _, relativePath := range files {
		stagedPath, err := safeToolPath(stagingDir, relativePath)
		if err != nil {
			rollback()
			return err
		}
		livePath, err := safeToolPath(destDir, relativePath)
		if err != nil {
			rollback()
			return err
		}
		backupPath, err := safeToolPath(backupDir, relativePath)
		if err != nil {
			rollback()
			return err
		}
		if err := os.MkdirAll(filepath.Dir(livePath), 0o755); err != nil {
			rollback()
			return fmt.Errorf("prepare live tool directory: %w", err)
		}
		hadBackup := false
		if _, statErr := os.Lstat(livePath); statErr == nil {
			if err := os.MkdirAll(filepath.Dir(backupPath), 0o755); err != nil {
				rollback()
				return fmt.Errorf("prepare tool rollback path: %w", err)
			}
			if err := os.Rename(livePath, backupPath); err != nil {
				rollback()
				return fmt.Errorf("backup live tool %s: %w", relativePath, err)
			}
			hadBackup = true
		} else if !os.IsNotExist(statErr) {
			rollback()
			return fmt.Errorf("inspect live tool %s: %w", relativePath, statErr)
		}

		promoted = append(promoted, promotedFile{relativePath: relativePath, hadBackup: hadBackup})
		if err := os.Rename(stagedPath, livePath); err != nil {
			rollback()
			return fmt.Errorf("activate staged tool %s: %w", relativePath, err)
		}
	}
	return nil
}

func safeToolPath(root string, relativePath string) (string, error) {
	if filepath.IsAbs(relativePath) {
		return "", fmt.Errorf("illegal absolute tool path: %s", relativePath)
	}
	candidate := filepath.Join(root, filepath.Clean(relativePath))
	relative, err := filepath.Rel(filepath.Clean(root), candidate)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("illegal tool path: %s", relativePath)
	}
	return candidate, nil
}

func (c *Client) extractZip(srcZip string, destDir string, l *LoggerType) ([]string, error) {
	var extractedFiles []string
	r, err := zip.OpenReader(srcZip)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	for _, f := range r.File {
		if isIgnoredFile(f.Name) {
			continue
		}

		target, err := safeToolPath(destDir, f.Name)
		if err != nil {
			return nil, err
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(target, 0o755)
			continue
		}

		os.MkdirAll(filepath.Dir(target), 0o755)

		if !f.Mode().IsRegular() {
			return nil, fmt.Errorf("refuse non-regular file in tool archive: %s", f.Name)
		}
		outFile, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_RDWR, f.Mode())
		if err != nil {
			return nil, err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return nil, err
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if err != nil {
			return nil, err
		}

		if runtime.GOOS != "windows" {
			_ = os.Chmod(target, f.Mode()|0o755)
		}

		extractedFiles = append(extractedFiles, f.Name) // Lưu lại path tương đối
		l.Verbose("Extracted: %s", f.Name)
	}
	return extractedFiles, nil
}

func (c *Client) extractTarGz(srcGzip string, destDir string, l *LoggerType) ([]string, error) {
	var extractedFiles []string
	file, err := os.Open(srcGzip)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	gzr, err := gzip.NewReader(file)
	if err != nil {
		return nil, err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		if isIgnoredFile(header.Name) {
			continue
		}

		target, err := safeToolPath(destDir, header.Name)
		if err != nil {
			return nil, err
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return nil, err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return nil, err
			}

			f, err := os.OpenFile(target, os.O_CREATE|os.O_RDWR|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return nil, err
			}

			if _, err := io.Copy(f, tr); err != nil {
				f.Close()
				return nil, err
			}
			f.Close()

			if runtime.GOOS != "windows" {
				_ = os.Chmod(target, os.FileMode(header.Mode)|0o755)
			}

			extractedFiles = append(extractedFiles, header.Name)
			l.Verbose("Extracted: %s", header.Name)
		default:
			return nil, fmt.Errorf("refuse non-regular entry in tool archive: %s", header.Name)
		}
	}
	return extractedFiles, nil
}

func isIgnoredFile(fileName string) bool {
	lowerName := strings.ToLower(fileName)
	return strings.HasSuffix(lowerName, ".txt") || strings.HasSuffix(lowerName, ".md") || strings.HasSuffix(lowerName, ".pdf")
}

func (c *Client) runInitCommand(ctx context.Context, cmdStr string, workDir string) error {
	l := NewLogger("Worker.Init")
	parts := strings.Fields(cmdStr)
	if len(parts) == 0 {
		return nil
	}

	binaryName := parts[0]
	args := parts[1:]
	fullPath := filepath.Join(workDir, binaryName)

	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(fullPath), ".exe") {
		if _, err := os.Stat(fullPath + ".exe"); err == nil {
			fullPath += ".exe"
		}
	}

	if _, err := os.Stat(fullPath); err == nil {
		binaryName = fullPath
	}

	l.Debug("Running: %s", cmdStr)
	cmd := exec.CommandContext(ctx, binaryName, args...)
	cmd.Dir = workDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	pathEnv := os.Getenv("PATH")
	cmd.Env = append(os.Environ(), fmt.Sprintf("PATH=%s%c%s", workDir, os.PathListSeparator, pathEnv))

	return cmd.Run()
}

// State management helpers
func loadToolState(path string) map[string][]string {
	state := make(map[string][]string)
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &state)
	}
	return state
}

func saveToolState(path string, state map[string][]string) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".tool-versions-")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() { _ = os.Remove(temporaryPath) }()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}
