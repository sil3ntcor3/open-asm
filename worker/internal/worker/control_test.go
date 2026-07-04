package worker

import "testing"

func TestJobHandlePauseCancelsRunningJob(t *testing.T) {
	cancelled := false
	handle := &jobHandle{
		id: "job-1",
		cancel: func() {
			cancelled = true
		},
	}

	changed, err := handle.pause()

	if err != nil {
		t.Fatalf("pause returned error: %v", err)
	}
	if !changed {
		t.Fatal("pause did not report a state change")
	}
	if !cancelled {
		t.Fatal("pause did not cancel the running job")
	}
	if !handle.isPaused() {
		t.Fatal("pause did not mark the handle as paused")
	}
}
