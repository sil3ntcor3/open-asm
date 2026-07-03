//go:build windows

package worker

import (
	"errors"
	"os/exec"
)

var errNoControllableProcess = errors.New("job has no controllable process (not started yet or not an exec job)")

var errPauseUnsupported = errors.New("pause/resume of running jobs is not supported on Windows")

func killCommand(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}

// Windows has no SIGSTOP/SIGCONT equivalent that is safe to use from Go
// without undocumented NT APIs. Pausing an in-progress job is refused; core
// keeps the job in PAUSED state and the operator can stop or resume it.
func pauseProcessGroup(int) error {
	return errPauseUnsupported
}

func resumeProcessGroup(int) error {
	return errPauseUnsupported
}
