package worker

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	"github.com/oasm-platform/oasm-sdk-go/oasm"
	"github.com/sil3ntcor3/open-asm/grpc-client/go/jobs_registry"
)

const controlPollInterval = 3 * time.Second

// jobHandle is the worker-side control surface of one running job. STOP and
// PAUSE both cancel the job context, which interrupts the process group. Core
// owns the durable job status; a paused job can be requeued later.
type jobHandle struct {
	id     string
	cancel context.CancelFunc

	mu     sync.Mutex
	pid    int // process-group leader; 0 for non-exec jobs (e.g. screenshots)
	paused bool
}

func (h *jobHandle) setPid(pid int) {
	h.mu.Lock()
	h.pid = pid
	h.mu.Unlock()
}

// stop interrupts the job command and lets the command cancellation fallback
// hard-kill the process group if it ignores the interrupt.
func (h *jobHandle) stop() {
	h.cancel()
}

// pause interrupts the job command. This stops external scan tools at the scan
// window boundary instead of freezing them past the allowed run window.
func (h *jobHandle) pause() (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.paused {
		return false, nil
	}
	h.paused = true
	h.cancel()
	return true, nil
}

// resume is retained for compatibility with repeated control directives. A
// PAUSE now interrupts the command, so there is no local process to continue.
func (h *jobHandle) resume() (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return false, nil
}

func (h *jobHandle) isPaused() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.paused
}

// jobRegistry tracks all jobs currently held by this worker, keyed by job ID.
type jobRegistry struct {
	mu      sync.RWMutex
	handles map[string]*jobHandle
}

func newJobRegistry() *jobRegistry {
	return &jobRegistry{handles: make(map[string]*jobHandle)}
}

func (r *jobRegistry) add(h *jobHandle) {
	r.mu.Lock()
	r.handles[h.id] = h
	r.mu.Unlock()
}

func (r *jobRegistry) remove(id string) {
	r.mu.Lock()
	delete(r.handles, id)
	r.mu.Unlock()
}

func (r *jobRegistry) get(id string) *jobHandle {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.handles[id]
}

func (r *jobRegistry) count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.handles)
}

func (r *jobRegistry) activeIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.handles))
	for id := range r.handles {
		ids = append(ids, id)
	}
	return ids
}

// stopPaused interrupts every currently paused job during shutdown.
func (r *jobRegistry) stopPaused() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	stopped := 0
	for _, h := range r.handles {
		if h.isPaused() {
			h.stop()
			stopped++
		}
	}
	return stopped
}

// activeJobs is the single source of truth for what this worker is running.
var activeJobs = newJobRegistry()

// runControlLoop polls core for control directives: per-job stop/pause/
// resume orders, the desired concurrency limit, and the worker-level pause
// flag. Directives are derived from job statuses in the core database, so
// applying them is idempotent and safe to repeat every poll.
func runControlLoop(
	ctx context.Context,
	client *oasm.Client,
	sem *ResizableSemaphore,
	dispatchPaused *atomic.Bool,
	defaultConcurrency int,
	currentSession func() context.Context,
) {
	log := oasm.NewLogger("Worker.Control")
	ticker := time.NewTicker(controlPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		session := currentSession()
		if session == nil || session.Err() != nil {
			continue
		}

		reqCtx, cancel := context.WithTimeout(session, controlPollInterval*2)
		resp, err := client.Jobs().Control(client.WithAuth(reqCtx), &jobs_registry.ControlRequest{
			WorkerId:     client.WorkerID(),
			ActiveJobIds: activeJobs.activeIDs(),
		})
		cancel()
		if err != nil {
			log.Verbose("Control poll failed: %v", err)
			continue
		}

		// Runtime concurrency: 0 from core means "no override configured",
		// fall back to the worker's local configuration.
		desired := int(resp.GetMaxConcurrency())
		if desired <= 0 {
			desired = defaultConcurrency
		}
		if sem.SetLimit(desired) {
			log.Info("Max concurrency changed to %d (running jobs are never interrupted)", desired)
		}

		// Worker-level pause: stop pulling new jobs; running jobs continue.
		if dispatchPaused.Swap(resp.GetDispatchPaused()) != resp.GetDispatchPaused() {
			if resp.GetDispatchPaused() {
				log.Warning("Worker paused by core. Suspending job polling...")
			} else {
				log.Success("Worker resumed by core. Job polling re-enabled")
			}
		}

		for _, d := range resp.GetDirectives() {
			applyDirective(log, d)
		}
	}
}

func applyDirective(log *oasm.LoggerType, d *jobs_registry.JobDirective) {
	h := activeJobs.get(d.GetJobId())
	if h == nil {
		// Job finished between our report and the response; nothing to do.
		return
	}

	switch d.GetAction() {
	case jobs_registry.JobControlAction_JOB_CONTROL_STOP:
		log.Warning("[%s] Stop requested by core. Killing job process...", h.id)
		h.stop()
	case jobs_registry.JobControlAction_JOB_CONTROL_PAUSE:
		if changed, err := h.pause(); err != nil {
			log.Warning("[%s] Pause not applied: %v", h.id, err)
		} else if changed {
			log.Info("[%s] Job paused (process interrupted)", h.id)
		}
	case jobs_registry.JobControlAction_JOB_CONTROL_RESUME:
		if changed, err := h.resume(); err != nil {
			log.Warning("[%s] Resume failed: %v", h.id, err)
		} else if changed {
			log.Success("[%s] Job resumed", h.id)
		}
	}
}
