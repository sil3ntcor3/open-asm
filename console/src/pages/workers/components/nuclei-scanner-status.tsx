import { Badge } from '@/components/ui/badge';
import dayjs from 'dayjs';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';

export interface NucleiScannerHealth {
  nucleiEngineVersion?: string | null;
  nucleiTemplateVersion?: string | null;
  nucleiTemplateSource?: string | null;
  nucleiTemplateStatus?: string | null;
  nucleiTemplateLastAttemptAt?: string | null;
  nucleiTemplateLastSuccessAt?: string | null;
  nucleiTemplateValidatedAt?: string | null;
  nucleiTemplateLastError?: string | null;
  scannerStatusUpdatedAt?: string | null;
}

interface NucleiScannerStatusProps {
  worker: NucleiScannerHealth;
}

const STATUS_PRESENTATION = {
  ready: {
    label: 'Scanner healthy',
    icon: CheckCircle2,
    className:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  refreshing: {
    label: 'Updating templates',
    icon: RefreshCw,
    className:
      'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
  stale: {
    label: 'Update delayed',
    icon: AlertTriangle,
    className:
      'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  error: {
    label: 'Scanner unavailable',
    icon: AlertTriangle,
    className: 'border-destructive/40 bg-destructive/10 text-destructive',
  },
} as const;

const SCANNER_STATUS_OVERDUE_MINUTES = 30;
const OVERDUE_PRESENTATION = {
  label: 'Status report overdue',
  icon: AlertTriangle,
  className:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
} as const;

/** Formats an optional scanner timestamp for compact operator-facing display. */
function formatScannerTimestamp(value?: string | null): string | undefined {
  if (!value) return undefined;
  const timestamp = dayjs(value);
  return timestamp.isValid()
    ? timestamp.format('MMM D, YYYY h:mm A')
    : undefined;
}

/** Displays Nuclei engine, template, freshness, validation, and update health. */
export function NucleiScannerStatus({ worker }: NucleiScannerStatusProps) {
  const reportTimestamp = worker.scannerStatusUpdatedAt
    ? dayjs(worker.scannerStatusUpdatedAt)
    : undefined;
  const reportOverdue = Boolean(
    reportTimestamp?.isValid() &&
    dayjs().diff(reportTimestamp, 'minute') > SCANNER_STATUS_OVERDUE_MINUTES,
  );
  const statusPresentation = worker.nucleiTemplateStatus
    ? STATUS_PRESENTATION[
        worker.nucleiTemplateStatus as keyof typeof STATUS_PRESENTATION
      ]
    : undefined;
  const presentation = reportOverdue
    ? OVERDUE_PRESENTATION
    : statusPresentation;

  if (!presentation) {
    return (
      <div
        className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground"
        aria-label="Nuclei scanner health"
      >
        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
        Waiting for scanner status
      </div>
    );
  }

  const StatusIcon = presentation.icon;
  const validatedAt = formatScannerTimestamp(worker.nucleiTemplateValidatedAt);
  const updatedAt = formatScannerTimestamp(worker.nucleiTemplateLastSuccessAt);

  return (
    <section
      className="space-y-2 border-t pt-3"
      aria-label="Nuclei scanner health"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={presentation.className}>
          <StatusIcon
            className={`mr-1 h-3.5 w-3.5 ${!reportOverdue && worker.nucleiTemplateStatus === 'refreshing' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {presentation.label}
        </Badge>
        {validatedAt && (
          <span className="text-[11px] text-muted-foreground">
            Validated {validatedAt}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span>Nuclei {worker.nucleiEngineVersion || 'unknown'}</span>
        <span>Templates {worker.nucleiTemplateVersion || 'unknown'}</span>
      </div>

      {updatedAt && (
        <p className="text-[11px] text-muted-foreground">
          Templates updated {updatedAt}
        </p>
      )}

      {worker.nucleiTemplateLastError && (
        <p
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200"
        >
          {worker.nucleiTemplateLastError}
        </p>
      )}

      {reportOverdue && !worker.nucleiTemplateLastError && (
        <p
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200"
        >
          No scanner health report has arrived in the last 30 minutes.
        </p>
      )}
    </section>
  );
}
