package worker

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestRunWorkerConnectionLifecycleReconnectsDuringReadiness(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	connectionStates := make(chan bool)
	firstAttemptStarted := make(chan struct{})
	firstAttemptCancelled := make(chan struct{})
	activated := make(chan context.Context, 1)
	done := make(chan struct{})
	var attempts atomic.Int32

	go func() {
		defer close(done)
		runWorkerConnectionLifecycle(
			ctx,
			connectionStates,
			workerConnectionLifecycleCallbacks{
				initialize: func(attemptCtx context.Context) error {
					switch attempts.Add(1) {
					case 1:
						close(firstAttemptStarted)
						<-attemptCtx.Done()
						close(firstAttemptCancelled)
						return attemptCtx.Err()
					default:
						return nil
					}
				},
				activate: func(sessionCtx context.Context) {
					activated <- sessionCtx
				},
				deactivate: func() {},
				onInitializationError: func(error) {
					t.Error("unexpected initialization error")
				},
			},
		)
	}()

	connectionStates <- true
	waitForTestSignal(t, firstAttemptStarted, "first readiness attempt")

	connectionStates <- false
	connectionStates <- true

	waitForTestSignal(t, firstAttemptCancelled, "first readiness cancellation")
	select {
	case sessionCtx := <-activated:
		if sessionCtx.Err() != nil {
			t.Fatalf("activated session context error = %v", sessionCtx.Err())
		}
	case <-time.After(time.Second):
		t.Fatal("reconnected worker was not activated")
	}

	if got := attempts.Load(); got != 2 {
		t.Fatalf("readiness attempts = %d, want 2", got)
	}

	cancel()
	waitForTestSignal(t, done, "connection lifecycle shutdown")
}

func TestNotifyConnectionStateWaitsForConsumer(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	connectionStates := make(chan bool, 1)
	connectionStates <- false
	notified := make(chan bool, 1)

	go func() {
		notified <- notifyConnectionState(ctx, connectionStates, true)
	}()

	select {
	case <-notified:
		t.Fatal("connection state notification returned before the queued state was consumed")
	case <-time.After(25 * time.Millisecond):
	}

	if got := <-connectionStates; got {
		t.Fatal("queued connection state = true, want false")
	}
	if ok := <-notified; !ok {
		t.Fatal("connection state notification was cancelled")
	}
	if got := <-connectionStates; !got {
		t.Fatal("next connection state = false, want true")
	}
}

func waitForTestSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()

	select {
	case <-signal:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}
