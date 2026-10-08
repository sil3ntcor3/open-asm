package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/oasm-platform/oasm-sdk-go/oasm"
	"github.com/sil3ntcor3/open-asm/grpc-client/go/workers"
)

const (
	nucleiScannerStatusReportInterval = 5 * time.Minute
	nucleiScannerStatusReportTimeout  = 10 * time.Second
)

// nucleiScannerStatusRequest maps local scanner health into the authenticated
// worker status contract while omitting timestamps that have never occurred.
func nucleiScannerStatusRequest(status nucleiScannerStatus) *workers.ScannerStatusReportRequest {
	request := &workers.ScannerStatusReportRequest{
		EngineVersion:   status.EngineVersion,
		TemplateVersion: status.TemplateVersion,
		TemplateSource:  status.TemplateSource,
		State:           string(status.State),
	}
	if !status.LastUpdateAttemptAt.IsZero() {
		value := status.LastUpdateAttemptAt.Format(time.RFC3339Nano)
		request.LastUpdateAttemptAt = &value
	}
	if !status.LastUpdateSuccessAt.IsZero() {
		value := status.LastUpdateSuccessAt.Format(time.RFC3339Nano)
		request.LastUpdateSuccessAt = &value
	}
	if !status.LastValidatedAt.IsZero() {
		value := status.LastValidatedAt.Format(time.RFC3339Nano)
		request.LastValidatedAt = &value
	}
	if status.LastError != "" {
		request.LastError = &status.LastError
	}
	return request
}

// reportNucleiScannerStatus publishes scanner health using the issued worker
// identity carried by the authenticated gRPC context.
func reportNucleiScannerStatus(
	ctx context.Context,
	client *oasm.Client,
	status nucleiScannerStatus,
) error {
	_, err := client.Workers().ReportScannerStatus(
		client.WithAuth(ctx),
		nucleiScannerStatusRequest(status),
	)
	if err != nil {
		return fmt.Errorf("report Nuclei scanner status: %w", err)
	}
	return nil
}

// loadNucleiScannerStatus reads the atomically persisted scanner state without
// validating, refreshing, or otherwise changing the active template set.
func loadNucleiScannerStatus(toolPath string) nucleiScannerStatus {
	status, _ := readNucleiScannerStatus(toolPath)
	return status
}

// readNucleiScannerStatus reconstructs report severity from persisted scanner
// metadata and returns state-file failures separately for fallback handling.
func readNucleiScannerStatus(toolPath string) (nucleiScannerStatus, error) {
	state, err := loadNucleiTemplateState(toolPath)
	if err != nil {
		return nucleiScannerStatus{
			TemplateSource: nucleiTemplateSource,
			State:          nucleiScannerStateError,
			LastError: boundedNucleiStatusError(
				fmt.Errorf("load persisted Nuclei scanner state: %w", err),
			),
		}, err
	}
	if state.TemplateSource == "" {
		state.TemplateSource = nucleiTemplateSource
	}
	status := nucleiStatusFromState(state, 0, time.Time{})
	if state.LastValidatedAt.IsZero() {
		status.State = nucleiScannerStateError
	}
	return status, nil
}

// newNucleiScannerStatusLoader retains the last reliable scanner metadata so
// a transient state-file read failure cannot erase it from Core.
func newNucleiScannerStatusLoader(
	toolPath string,
	initial nucleiScannerStatus,
) func() nucleiScannerStatus {
	last := initial
	return func() nucleiScannerStatus {
		status, err := readNucleiScannerStatus(toolPath)
		if err == nil {
			last = status
			return status
		}
		if last.TemplateSource == "" {
			last.TemplateSource = nucleiTemplateSource
		}
		last.LastError = status.LastError
		if last.LastValidatedAt.IsZero() {
			last.State = nucleiScannerStateError
		} else {
			last.State = nucleiScannerStateStale
		}
		return last
	}
}

// runNucleiScannerStatusReportLoop publishes the latest persisted scanner
// state independently from administrator-controlled tool update polling.
func runNucleiScannerStatusReportLoop(
	ctx context.Context,
	interval time.Duration,
	status func() nucleiScannerStatus,
	report func(context.Context, nucleiScannerStatus) error,
	onError func(error),
) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			reportCtx, cancel := context.WithTimeout(ctx, nucleiScannerStatusReportTimeout)
			err := report(reportCtx, status())
			cancel()
			if err != nil && ctx.Err() == nil && onError != nil {
				onError(err)
			}
		}
	}
}
