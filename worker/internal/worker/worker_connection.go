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
			notifyConnectionState(ready, false)
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
		notifyConnectionState(ready, true)

		err = client.WorkerAlive(ctx)
		notifyConnectionState(ready, false)
		if err != nil {
			log.Warning("Alive stream interrupted: %v. Reconnecting with worker identity...", err)
		}
		if !waitForReconnect(ctx, time.Second) {
			return
		}
	}
}

func notifyConnectionState(ready chan<- bool, connected bool) {
	select {
	case ready <- connected:
	default:
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
