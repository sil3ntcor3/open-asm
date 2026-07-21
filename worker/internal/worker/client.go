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

const nucleiTemplateRefreshCheckInterval = 15 * time.Minute

func connectInternalNetwork(ctx context.Context, client *oasm.Client, network string) error {
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

	_, err = client.Workers().ConnectInternalNetwork(client.WithAuth(ctx), req)
	if err != nil {
		return fmt.Errorf("error connecting internal network: %w", err)
	}

	return nil
}

// Start connects the worker, validates scanner readiness, and runs the bounded job scheduler.
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

	ready := make(chan bool)
	workerCtx, workerCancel := context.WithCancel(context.Background())
	defer workerCancel()

	var (
		stateMu          sync.Mutex
		sessionCtx       context.Context
		sessionCancel    context.CancelFunc
		schedulerStarted bool
		refreshStarted   bool
	)

	// Concurrency limit and worker-level pause are runtime-controllable from
	// Core (control poll); local config is the default / fallback.
	semaphore := NewResizableSemaphore(cfg.MaxConcurrency)
	var dispatchPaused atomic.Bool
	scheduler := gocron.NewScheduler(time.UTC)
	var wg sync.WaitGroup
	var nucleiRefreshWG sync.WaitGroup
	nucleiRefreshOptions := nucleiTemplateRefreshOptions{
		refreshInterval: cfg.NucleiTemplateRefreshInterval,
		maxStale:        cfg.NucleiTemplateMaxStale,
		now:             time.Now,
	}

	refreshNucleiTemplates := func(refreshCtx context.Context, synchronizeTools bool) (nucleiScannerStatus, bool, error) {
		var status nucleiScannerStatus
		toolsReady := !synchronizeTools
		err := withToolCacheLock(
			refreshCtx,
			toolPath,
			defaultToolCacheLockOptions,
			func() error {
				if synchronizeTools {
					if err := client.WorkerDownloadTools(client.WithAuth(refreshCtx)); err != nil {
						return fmt.Errorf("download tools: %w", err)
					}
					toolsReady = true
				}
				var reconcileErr error
				status, reconcileErr = reconcileNucleiTemplates(
					refreshCtx,
					toolPath,
					nucleiRefreshOptions,
					runCommandOutput,
				)
				return reconcileErr
			},
		)
		if err != nil && status.State == "" {
			status = nucleiStatusForWrapperFailure(toolPath, nucleiRefreshOptions, err)
		}
		return status, toolsReady, err
	}

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

	connectionLifecycleDone := make(chan struct{})
	go func() {
		defer close(connectionLifecycleDone)
		runWorkerConnectionLifecycle(
			ctx,
			ready,
			workerConnectionLifecycleCallbacks{
				initialize: func(candidateCtx context.Context) error {
					sysLog.Success("Worker connected/reconnected. Initializing sub-systems...")

					if cfg.Network != "" {
						if err := connectInternalNetwork(candidateCtx, client, cfg.Network); err != nil {
							return fmt.Errorf("connect internal network: %w", err)
						}
						netLog.Success("Connected to internal network: %s", cfg.Network)
					}

					return waitForWorkerReadiness(
						candidateCtx,
						defaultWorkerReadinessOptions,
						func(attemptCtx context.Context) error {
							status, toolsReady, refreshErr := refreshNucleiTemplates(attemptCtx, true)
							if reportErr := reportNucleiScannerStatus(attemptCtx, client, status); reportErr != nil {
								sysLog.Warning("Unable to report Nuclei scanner status: %v", reportErr)
							}
							if refreshErr == nil && status.LastError != "" {
								sysLog.Warning("Nuclei templates are usable but their refresh is delayed: %s", status.LastError)
							}
							if toolsReady {
								// Core gates only Nuclei while its templates are unavailable;
								// unrelated scanners can start as soon as their tools are ready.
								return nil
							}
							return refreshErr
						},
						func(readinessErr error) {
							sysLog.ErrorE("Scanner readiness failed; retrying", readinessErr)
						},
					)
				},
				activate: func(candidateCtx context.Context) {
					stateMu.Lock()
					defer stateMu.Unlock()

					sessionCtx, sessionCancel = context.WithCancel(candidateCtx)
					if !schedulerStarted {
						scheduler.StartAsync()
						jobLog.Success("Gocron poller started (Max Concurrency: %d)", cfg.MaxConcurrency)
						schedulerStarted = true
					}
					if !refreshStarted {
						refreshStarted = true
						nucleiRefreshWG.Go(func() {
							checkInterval := nucleiTemplateRefreshCheckInterval
							if cfg.NucleiTemplateRefreshInterval < checkInterval {
								checkInterval = cfg.NucleiTemplateRefreshInterval
							}
							runNucleiTemplateRefreshLoop(
								ctx,
								checkInterval,
								func(loopCtx context.Context) (nucleiScannerStatus, error) {
									attemptCtx, cancelAttempt := context.WithTimeout(loopCtx, defaultWorkerReadinessOptions.attemptTimeout)
									defer cancelAttempt()
									status, _, refreshErr := refreshNucleiTemplates(attemptCtx, false)
									return status, refreshErr
								},
								func(status nucleiScannerStatus, refreshErr error) {
									reportCtx, cancelReport := context.WithTimeout(ctx, 10*time.Second)
									reportErr := reportNucleiScannerStatus(reportCtx, client, status)
									cancelReport()
									if reportErr != nil && ctx.Err() == nil {
										sysLog.Warning("Unable to report Nuclei scanner status: %v", reportErr)
									}
									if refreshErr != nil {
										sysLog.ErrorE("Nuclei template refresh failed", refreshErr)
									} else if status.LastError != "" {
										sysLog.Warning("Nuclei template refresh delayed: %s", status.LastError)
									}
								},
							)
						})
					}
				},
				deactivate: func() {
					stateMu.Lock()
					defer stateMu.Unlock()

					if sessionCancel != nil {
						sessionCancel()
					}
					sessionCtx = nil
					sessionCancel = nil
				},
				onDisconnected: func() {
					sysLog.Warning("Worker disconnected from core. Suspending job poller and streams...")
				},
				onInitializationError: func(initializationErr error) {
					sysLog.ErrorE("Worker subsystem initialization stopped", initializationErr)
				},
			},
		)
	}()

	connectorDone := make(chan struct{})
	go func() {
		defer close(connectorDone)
		connectWorker(workerCtx, client, ready)
	}()

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
	<-connectorDone
	<-connectionLifecycleDone
	nucleiRefreshWG.Wait()
	shutLog.Success("Worker shut down safely")
}
