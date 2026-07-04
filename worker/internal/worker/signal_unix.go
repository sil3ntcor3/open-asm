//go:build !windows

package worker

import (
	"os/exec"
	"syscall"
	"time"
)

const commandKillGracePeriod = 10 * time.Second

// killCommand interrupts the whole process group of a job command and then
// hard-kills anything still alive after a short grace period. Scan tools are
// started via `sh -c` with Setpgid, so signalling only the shell would leak
// the actual scanner underneath it. SIGINT gives tools such as nuclei a
// chance to write their resume state before the fallback SIGKILL is sent.
func killCommand(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	pid := cmd.Process.Pid
	if err := syscall.Kill(-pid, syscall.SIGINT); err != nil {
		// Fall back to killing the direct child (group may already be gone).
		return cmd.Process.Kill()
	}
	go func() {
		time.Sleep(commandKillGracePeriod)
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			return
		}
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}()
	return nil
}
