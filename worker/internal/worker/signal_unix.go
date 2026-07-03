//go:build !windows

package worker

import (
	"errors"
	"os/exec"
	"syscall"
)

var errNoControllableProcess = errors.New("job has no controllable process (not started yet or not an exec job)")

// killCommand kills the whole process group of a job command. Scan tools
// are started via `sh -c` with Setpgid, so killing only the shell (the Go
// default) would leak the actual scanner underneath it. SIGKILL also
// terminates SIGSTOPped (paused) groups, so no SIGCONT is required first.
func killCommand(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
		// Fall back to killing the direct child (group may already be gone).
		return cmd.Process.Kill()
	}
	return nil
}

func pauseProcessGroup(pid int) error {
	return syscall.Kill(-pid, syscall.SIGSTOP)
}

func resumeProcessGroup(pid int) error {
	return syscall.Kill(-pid, syscall.SIGCONT)
}
