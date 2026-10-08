package worker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const toolCacheLockDirectoryName = ".oasm-tools-sync.lock"

type toolCacheLockOptions struct {
	pollInterval time.Duration
	staleAfter   time.Duration
}

type workerReadinessOptions struct {
	attemptTimeout time.Duration
	retryDelay     time.Duration
}

type workerConnectionLifecycleCallbacks struct {
	initialize            func(context.Context) error
	activate              func(context.Context)
	deactivate            func()
	onDisconnected        func()
	onInitializationError func(error)
}

type workerConnectionInitializationResult struct {
	generation uint64
	ctx        context.Context
	err        error
}

var (
	defaultToolCacheLockOptions = toolCacheLockOptions{
		pollInterval: 250 * time.Millisecond,
		staleAfter:   15 * time.Minute,
	}
	defaultWorkerReadinessOptions = workerReadinessOptions{
		attemptTimeout: 5 * time.Minute,
		retryDelay:     15 * time.Second,
	}
)

// runWorkerConnectionLifecycle keeps connection-state consumption non-blocking
// while scanner readiness runs in a connection-scoped goroutine. Every state
// transition cancels the preceding generation, so stale readiness results can
// never activate a later connection.
func runWorkerConnectionLifecycle(
	ctx context.Context,
	connectionStates <-chan bool,
	callbacks workerConnectionLifecycleCallbacks,
) {
	lifecycleCtx, lifecycleCancel := context.WithCancel(ctx)
	results := make(chan workerConnectionInitializationResult)

	var (
		generation    uint64
		currentCancel context.CancelFunc
		initializers  sync.WaitGroup
	)

	deactivateCurrent := func() {
		if currentCancel != nil {
			currentCancel()
			currentCancel = nil
		}
		callbacks.deactivate()
	}

	defer func() {
		lifecycleCancel()
		deactivateCurrent()
		initializers.Wait()
	}()

	for {
		select {
		case <-lifecycleCtx.Done():
			return
		case connected, ok := <-connectionStates:
			generation++
			deactivateCurrent()
			if !ok {
				return
			}
			if !connected {
				if callbacks.onDisconnected != nil {
					callbacks.onDisconnected()
				}
				continue
			}

			candidateCtx, candidateCancel := context.WithCancel(lifecycleCtx)
			currentCancel = candidateCancel
			candidateGeneration := generation

			initializers.Add(1)
			go func() {
				defer initializers.Done()
				initializationErr := callbacks.initialize(candidateCtx)
				result := workerConnectionInitializationResult{
					generation: candidateGeneration,
					ctx:        candidateCtx,
					err:        initializationErr,
				}
				select {
				case results <- result:
				case <-lifecycleCtx.Done():
				}
			}()
		case result := <-results:
			if result.generation != generation {
				continue
			}
			if result.err != nil {
				deactivateCurrent()
				if !isContextError(result.err) && callbacks.onInitializationError != nil {
					callbacks.onInitializationError(result.err)
				}
				continue
			}
			if result.ctx.Err() != nil {
				continue
			}
			callbacks.activate(result.ctx)
		}
	}
}

// withToolCacheLock serializes tool synchronization across workers sharing one cache volume.
func withToolCacheLock(
	ctx context.Context,
	toolPath string,
	options toolCacheLockOptions,
	action func() error,
) error {
	absToolPath, err := filepath.Abs(toolPath)
	if err != nil {
		return fmt.Errorf("resolve worker tool path for lock: %w", err)
	}
	if err := os.MkdirAll(absToolPath, 0o755); err != nil {
		return fmt.Errorf("create worker tool path for lock: %w", err)
	}

	lockPath := filepath.Join(absToolPath, toolCacheLockDirectoryName)
	for {
		err := os.Mkdir(lockPath, 0o700)
		if err == nil {
			actionErr := action()
			releaseErr := os.Remove(lockPath)
			if actionErr != nil {
				return actionErr
			}
			if releaseErr != nil && !os.IsNotExist(releaseErr) {
				return fmt.Errorf("release worker tool cache lock: %w", releaseErr)
			}
			return nil
		}
		if !os.IsExist(err) {
			return fmt.Errorf("acquire worker tool cache lock: %w", err)
		}

		lockInfo, statErr := os.Stat(lockPath)
		if statErr == nil && time.Since(lockInfo.ModTime()) > options.staleAfter {
			if removeErr := os.Remove(lockPath); removeErr == nil || os.IsNotExist(removeErr) {
				continue
			}
		} else if statErr != nil && !os.IsNotExist(statErr) {
			return fmt.Errorf("inspect worker tool cache lock: %w", statErr)
		}

		timer := time.NewTimer(options.pollInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// waitForWorkerReadiness retries bounded initialization attempts until scanners are ready or the worker stops.
func waitForWorkerReadiness(
	ctx context.Context,
	options workerReadinessOptions,
	prepare func(context.Context) error,
	onFailure func(error),
) error {
	for {
		attemptCtx, cancelAttempt := context.WithTimeout(ctx, options.attemptTimeout)
		err := prepare(attemptCtx)
		cancelAttempt()
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if onFailure != nil {
			onFailure(err)
		}

		timer := time.NewTimer(options.retryDelay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// isContextError reports whether an initialization failure was caused by cancellation or a deadline.
func isContextError(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}
