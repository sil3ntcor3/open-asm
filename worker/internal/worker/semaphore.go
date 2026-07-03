package worker

import "sync"

// ResizableSemaphore is a counting semaphore whose limit can be changed at
// runtime (unlike a buffered channel). Growing the limit frees slots
// immediately; shrinking never interrupts holders — the new limit simply
// gates further acquisitions, so in-flight jobs always run to completion.
type ResizableSemaphore struct {
	mu    sync.Mutex
	limit int
	inUse int
}

func NewResizableSemaphore(limit int) *ResizableSemaphore {
	if limit < 1 {
		limit = 1
	}
	return &ResizableSemaphore{limit: limit}
}

// TryAcquire claims a slot if one is free. It never blocks.
func (s *ResizableSemaphore) TryAcquire() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.inUse >= s.limit {
		return false
	}
	s.inUse++
	return true
}

func (s *ResizableSemaphore) Release() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.inUse > 0 {
		s.inUse--
	}
}

// SetLimit updates the concurrency limit and reports whether it changed.
// Values below 1 are ignored.
func (s *ResizableSemaphore) SetLimit(limit int) bool {
	if limit < 1 {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit == s.limit {
		return false
	}
	s.limit = limit
	return true
}

// Snapshot returns the current usage and limit.
func (s *ResizableSemaphore) Snapshot() (inUse, limit int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.inUse, s.limit
}
