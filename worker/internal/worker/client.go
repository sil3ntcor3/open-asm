package worker

import (
	"context"
	"fmt"
	"oasm-worker/internal/config"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-co-op/gocron"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/oasm-platform/oasm-sdk-go/oasm"
	"github.com/sil3ntcor3/open-asm/grpc-client/go/workers"
	"google.golang.org/grpc"
)

func connectInternalNetwork(client *oasm.Client, network string) error {
	networkInfos, err := GetNetworkInfos()
	if err != nil {
		return fmt.Errorf("failed to get network infos: %w", err)
	}

	var networkInterfaces []*workers.NetworkInterfaceMessage
	for _, info := range networkInfos {
		networkInterfaces = append(networkInterfaces, &workers.NetworkInterfaceMessage{
			InterfaceName: info.Interface,
			IpAddress:     info.IP,
			Cidr:          info.CIDR,
			GatewayIp:     info.GatewayIP,
			GatewayMac:    info.GatewayMAC,
		})
	}

	req := &workers.ConnectInternalNetworkRequest{
		WorkerId:          client.WorkerID(),
		NetworkId:         network,
		NetworkInterfaces: networkInterfaces,
	}

	_, err = client.Workers().ConnectInternalNetwork(client.WithAuth(context.Background()), req)
	if err != nil {
		return fmt.Errorf("error connecting internal network: %w", err)
	}

	return nil
}

func Start(ctx context.Context, cfg *config.Config) {
	sysLog := oasm.NewLogger("System")
	jobLog := oasm.NewLogger("Jobs")
	netLog := oasm.NewLogger("Network")
	shutLog := oasm.NewLogger("Shutdown")

	grpcHost := fmt.Sprintf("%s:%d", cfg.GrpcHost, cfg.GrpcPort)
	transportCredentials, err := newGRPCTransportCredentials(cfg)
	if err != nil {
		sysLog.ErrorE("Invalid gRPC transport configuration", err)
		return
	}
	connection, err := grpc.NewClient(
		grpcHost,
		grpc.WithTransportCredentials(transportCredentials),
	)
	if err != nil {
		sysLog.ErrorE("Failed to create gRPC connection", err)
		return
	}

	client, err := oasm.NewClient(
		oasm.WithApiKey(cfg.ApiKey),
		oasm.WithGRPCHost(grpcHost),
		oasm.WithConn(connection),
		oasm.WithToolPath(cfg.ToolPath),
	)
	if err != nil {
		_ = connection.Close()
		sysLog.ErrorE("Failed to create OASM client", err)
		return
	}
	defer func() {
		if err := client.Close(); err != nil {
			sysLog.Warning("gRPC connection close warning: %v", err)
		}
	}()

	jobLog.Info("Initializing headless browser...")
	l := launcher.New().Leakless(false).Headless(true)

	if _, err := os.Stat("/usr/bin/chromium"); err == nil {
		jobLog.Verbose("Using system chromium at /usr/bin/chromium")
		l = l.Bin("/usr/bin/chromium")
	} else if _, err := os.Stat("/usr/bin/chromium-browser"); err == nil {
		jobLog.Verbose("Using system chromium at /usr/bin/chromium-browser")
		l = l.Bin("/usr/bin/chromium-browser")
	} else if _, err := os.Stat("/usr/bin/google-chrome"); err == nil {
		jobLog.Verbose("Using system chromium at /usr/bin/google-chrome")
		l = l.Bin("/usr/bin/google-chrome")
	} else {
		jobLog.Verbose("No system chromium found, go-rod will download Chrome automatically")
	}

	browser := rod.New().ControlURL(l.MustLaunch()).MustConnect()

	toolPath, err := filepath.Abs(cfg.ToolPath)
	if err != nil {
		sysLog.ErrorE("Failed to resolve tool path", err)
		return
	}

	ready := make(chan bool, 1)
	workerCtx, workerCancel := context.WithCancel(context.Background())
	defer workerCancel()

	var (
		stateMu          sync.Mutex
		sessionCtx       context.Context
		sessionCancel    context.CancelFunc
		schedulerStarted bool
	)

	// Concurrency limit and worker-level pause are runtime-controllable from
	// Core (control poll); local config is the default / fallback.
	semaphore := NewResizableSemaphore(cfg.MaxConcurrency)
	var dispatchPaused atomic.Bool
	scheduler := gocron.NewScheduler(time.UTC)
	var wg sync.WaitGroup

	currentSession := func() context.Context {
		stateMu.Lock()
		defer stateMu.Unlock()
		return sessionCtx
	}

	_, err = scheduler.Every(1).Second().Do(func() {
		currentCtx := currentSession()

		if currentCtx == nil || currentCtx.Err() != nil {
			return
		}

		if dispatchPaused.Load() {
			return
		}

		if !semaphore.TryAcquire() {
			return
		}
		wg.Go(func() {
			defer semaphore.Release()
			processJob(currentCtx, client, browser, toolPath, executionLimits{
				timeout:          cfg.JobTimeout,
				stdoutLimitBytes: cfg.JobStdoutLimitBytes,
				stderrLimitBytes: cfg.JobStderrLimitBytes,
			})
		})
	})
	if err != nil {
		sysLog.ErrorE("Failed to schedule job", err)
		return
	}

	// Bound to the signal ctx (not workerCtx): once shutdown starts, no more
	// directives may be applied while the worker drains active jobs.
	go runControlLoop(ctx, client, semaphore, &dispatchPaused, cfg.MaxConcurrency, currentSession)

	go func() {
		for {
			select {
			case <-ctx.Done():
				stateMu.Lock()
				if sessionCancel != nil {
					sessionCancel()
				}
				stateMu.Unlock()
				return
			case isConnected, ok := <-ready:
				if !ok {
					return
				}

				stateMu.Lock()
				if sessionCancel != nil {
					sessionCancel()
				}

				if isConnected {
					sysLog.Success("Worker connected/reconnected. Initializing sub-systems...")
					sessionCtx, sessionCancel = context.WithCancel(ctx)

					if cfg.Network != "" {
						if err := connectInternalNetwork(client, cfg.Network); err != nil {
							netLog.ErrorE("Failed to connect internal network", err)
							stateMu.Unlock()
							continue
						}
						netLog.Success("Connected to internal network: %s", cfg.Network)
					}

					if err := client.WorkerDownloadTools(client.WithAuth(sessionCtx)); err != nil {
						sysLog.ErrorE("Download tools failed", err)
						stateMu.Unlock()
						continue
					}

					if !schedulerStarted {
						scheduler.StartAsync()
						jobLog.Success("Gocron poller started (Max Concurrency: %d)", cfg.MaxConcurrency)
						schedulerStarted = true
					}
				} else {
					sysLog.Warning("Worker disconnected from core. Suspending job poller and streams...")
					sessionCtx = nil
					sessionCancel = nil
				}
				stateMu.Unlock()
			}
		}
	}()

	go connectWorker(workerCtx, client, ready)

	ticker := time.NewTicker(time.Second)
	go func() {
		defer ticker.Stop()
		var lastLogged int
		for {
			select {
			case <-ticker.C:
				running := activeJobs.count()
				_, limit := semaphore.Snapshot()

				if running != lastLogged {
					jobLog.Verbose("Jobs running: %d/%d", running, limit)
					lastLogged = running
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	<-ctx.Done()
	shutLog.Info("Signal received. Stopping scheduler...")

	scheduler.Stop()
	shutLog.Info("Scheduler stopped. Waiting for running jobs to finish...")

	// Paused jobs should already be interrupting, but repeat the stop request
	// during shutdown so the drain cannot wait on a stale handle.
	if stopped := activeJobs.stopPaused(); stopped > 0 {
		shutLog.Warning("Stopped %d paused job(s); they will be requeued by Core", stopped)
	}

	wg.Wait()
	shutLog.Info("All jobs completed. Cancelling session contexts...")

	stateMu.Lock()
	if sessionCancel != nil {
		sessionCancel()
	}
	stateMu.Unlock()

	if err := browser.Close(); err != nil {
		shutLog.Warning("Browser close warning: %v", err)
	}
	l.Kill()
	l.Cleanup()
	shutLog.Success("Browser killed safely")

	workerCancel()
	shutLog.Success("Worker shut down safely")
}
