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

// chromiumBinCandidates are the system chromium/chrome paths the worker prefers
// over rod's auto-download, in priority order.
var chromiumBinCandidates = []string{
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/google-chrome",
}

// resolveChromiumBin returns the first existing system chromium/chrome binary,
// or "" to let rod resolve/download one.
func resolveChromiumBin() string {
	for _, path := range chromiumBinCandidates {
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	return ""
}

// newBrowserLauncher builds the headless chromium launcher used for screenshots.
// It sets --ignore-certificate-errors so web services with a self-signed or
// mismatched TLS certificate (common across an attack surface) still load and
// screenshot instead of aborting navigation with net::ERR_CERT_COMMON_NAME_INVALID.
// A non-empty binPath pins a system browser; "" lets rod resolve one.
func newBrowserLauncher(binPath string) *launcher.Launcher {
	l := launcher.New().
		Leakless(false).
		Headless(true).
		Set("ignore-certificate-errors")
	if binPath != "" {
		l = l.Bin(binPath)
	}
	return l
}

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
	binPath := resolveChromiumBin()
	if binPath != "" {
		jobLog.Verbose("Using system chromium at %s", binPath)
	} else {
		jobLog.Verbose("No system chromium found, go-rod will download Chrome automatically")
	}

	l := newBrowserLauncher(binPath)
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
		stateMu              sync.Mutex
		sessionCtx           context.Context
		sessionCancel        context.CancelFunc
		schedulerStarted     bool
		scannerStatusStarted bool
		updatesStarted       bool
		initialScannerStatus nucleiScannerStatus
	)

	// Concurrency limit and worker-level pause are runtime-controllable from
	// Core (control poll); local config is the default / fallback.
	semaphore := NewResizableSemaphore(cfg.MaxConcurrency)
	var dispatchPaused atomic.Bool
	scheduler := gocron.NewScheduler(time.UTC)
	var wg sync.WaitGroup
	var scannerStatusWG sync.WaitGroup
	var toolUpdateWG sync.WaitGroup

	prepareScanners := func(prepareCtx context.Context, synchronizeTools bool) (nucleiScannerStatus, bool, error) {
		var status nucleiScannerStatus
		toolsReady := !synchronizeTools
		err := withToolCacheLock(
			prepareCtx,
			toolPath,
			defaultToolCacheLockOptions,
			func() error {
				if synchronizeTools {
					if err := client.WorkerDownloadTools(client.WithAuth(prepareCtx)); err != nil {
						return fmt.Errorf("download tools: %w", err)
					}
					toolsReady = true
				}
				var prepareErr error
				status, prepareErr = prepareNucleiTemplates(
					prepareCtx,
					toolPath,
					time.Now().UTC(),
					runCommandOutput,
				)
				return prepareErr
			},
		)
		if err != nil && status.State == "" {
			status = nucleiStatusForWrapperFailure(
				toolPath,
				nucleiTemplateRefreshOptions{now: time.Now},
				err,
			)
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
							status, toolsReady, prepareErr := prepareScanners(attemptCtx, true)
							initialScannerStatus = status
							if reportErr := reportNucleiScannerStatus(attemptCtx, client, status); reportErr != nil {
								sysLog.Warning("Unable to report Nuclei scanner status: %v", reportErr)
							}
							if reportErr := reportInstalledToolVersions(attemptCtx, client, toolPath, status); reportErr != nil {
								sysLog.Warning("Unable to report installed tool versions: %v", reportErr)
							}
							if toolsReady {
								// Core gates only Nuclei while its templates are unavailable;
								// unrelated scanners can start as soon as their tools are ready.
								return nil
							}
							return prepareErr
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
					if !scannerStatusStarted {
						scannerStatusStarted = true
						loadScannerStatus := newNucleiScannerStatusLoader(toolPath, initialScannerStatus)
						scannerStatusWG.Go(func() {
							runNucleiScannerStatusReportLoop(
								ctx,
								nucleiScannerStatusReportInterval,
								loadScannerStatus,
								func(reportCtx context.Context, status nucleiScannerStatus) error {
									return reportNucleiScannerStatus(reportCtx, client, status)
								},
								func(reportErr error) {
									sysLog.Warning("Unable to report Nuclei scanner status: %v", reportErr)
								},
							)
						})
					}
					if !updatesStarted {
						updatesStarted = true
						toolUpdateWG.Go(func() {
							runToolUpdateLoop(
								ctx,
								client,
								toolPath,
								func() bool { return activeJobs.count() > 0 },
								func(updateErr error) {
									sysLog.Warning("Tool update check failed: %v", updateErr)
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
	scannerStatusWG.Wait()
	toolUpdateWG.Wait()
	shutLog.Success("Worker shut down safely")
}
