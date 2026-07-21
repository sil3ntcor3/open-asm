package worker

import (
	"context"
	"time"

	"github.com/oasm-platform/oasm-sdk-go/oasm"
	"github.com/sil3ntcor3/open-asm/grpc-client/go/workers"
)

func connectWorker(ctx context.Context, client *oasm.Client, ready chan<- bool) {
	log := oasm.NewLogger("Worker.Connect")
	const (
		baseDelay = 2 * time.Second
		maxDelay  = 30 * time.Second
	)
	currentDelay := baseDelay
	workerToken := ""

	for ctx.Err() == nil {
		var err error
		if workerToken == "" {
			var response *workers.JoinResponse
			response, err = client.WorkerJoin(ctx)
			if err == nil {
				workerToken = response.WorkerToken
			}
		} else {
			_, err = client.Workers().Join(ctx, &workers.JoinRequest{
				Token: &workerToken,
			})
		}

		if err != nil {
			if !notifyConnectionState(ctx, ready, false) {
				return
			}
			log.ErrorE("Worker identity connection failed, retrying in %v", err, currentDelay)
			if !waitForReconnect(ctx, currentDelay) {
				return
			}
			currentDelay *= 2
			if currentDelay > maxDelay {
				currentDelay = maxDelay
			}
			continue
		}

		currentDelay = baseDelay
		log.Success("Worker identity connected. Worker ID: %s", client.WorkerID())
		if !notifyConnectionState(ctx, ready, true) {
			return
		}

		err = client.WorkerAlive(ctx)
		if !notifyConnectionState(ctx, ready, false) {
			return
		}
		if err != nil {
			log.Warning("Alive stream interrupted: %v. Reconnecting with worker identity...", err)
		}
		if !waitForReconnect(ctx, time.Second) {
			return
		}
	}
}

func notifyConnectionState(ctx context.Context, ready chan<- bool, connected bool) bool {
	select {
	case ready <- connected:
		return true
	case <-ctx.Done():
		return false
	}
}

func waitForReconnect(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
