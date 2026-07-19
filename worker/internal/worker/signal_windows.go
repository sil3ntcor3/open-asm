//go:build windows

package worker

import (
	"os/exec"
)

func killCommand(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
