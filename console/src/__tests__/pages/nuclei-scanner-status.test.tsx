import { NucleiScannerStatus } from '@/pages/workers/components/nuclei-scanner-status';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('NucleiScannerStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows template health without duplicating the Nuclei tool version', () => {
    render(
      <NucleiScannerStatus
        worker={{
          nucleiEngineVersion: 'v3.11.0',
          nucleiTemplateVersion: 'v10.4.6',
          nucleiTemplateSource: 'projectdiscovery/nuclei-templates',
          nucleiTemplateStatus: 'ready',
          nucleiTemplateLastSuccessAt: '2026-07-20T12:00:00.000Z',
          nucleiTemplateValidatedAt: '2026-07-20T12:05:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('Scanner healthy')).toBeInTheDocument();
    expect(screen.queryByText('Nuclei v3.11.0')).not.toBeInTheDocument();
    expect(screen.queryByText('Templates v10.4.6')).not.toBeInTheDocument();
    expect(screen.getByText(/Validated/)).toBeInTheDocument();
    expect(screen.queryByText(/Last update/)).not.toBeInTheDocument();
  });

  it('shows a delayed-update warning without template version text', () => {
    render(
      <NucleiScannerStatus
        worker={{
          nucleiEngineVersion: 'v3.11.0',
          nucleiTemplateVersion: 'v10.4.5',
          nucleiTemplateStatus: 'stale',
          nucleiTemplateLastError: 'template upstream unavailable',
          nucleiTemplateLastSuccessAt: '2026-07-20T06:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('Update delayed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'template upstream unavailable',
    );
    expect(screen.queryByText(/Templates/)).not.toBeInTheDocument();
  });

  it('shows a neutral pending state before a worker reports scanner health', () => {
    render(<NucleiScannerStatus worker={{}} />);

    expect(screen.getByText('Waiting for scanner status')).toBeInTheDocument();
  });

  it('does not show an unavailable template version', () => {
    render(
      <NucleiScannerStatus
        worker={{
          nucleiEngineVersion: '',
          nucleiTemplateVersion: '',
          nucleiTemplateStatus: 'error',
          nucleiTemplateLastError: 'scanner bootstrap failed',
        }}
      />,
    );

    expect(screen.queryByText('Nuclei unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('Templates unknown')).not.toBeInTheDocument();
  });

  it('does not leave an old worker report looking healthy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T13:00:00.000Z'));

    render(
      <NucleiScannerStatus
        worker={{
          nucleiEngineVersion: 'v3.11.0',
          nucleiTemplateVersion: 'v10.4.6',
          nucleiTemplateStatus: 'ready',
          scannerStatusUpdatedAt: '2026-07-20T12:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('Status report overdue')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No scanner health report has arrived in the last 30 minutes.',
    );
  });
});
