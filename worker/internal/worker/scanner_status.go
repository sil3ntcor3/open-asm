package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/oasm-platform/oasm-sdk-go/oasm"
	"github.com/sil3ntcor3/open-asm/grpc-client/go/workers"
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
