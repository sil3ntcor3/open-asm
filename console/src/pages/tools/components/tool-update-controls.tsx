import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import {
  getToolsControllerGetManyToolsQueryKey,
  type Tool,
  type ToolUpdateComponentDto,
  type ToolUpdateWorkerDto,
  useToolsControllerRequestToolUpdate,
} from '@/services/apis/gen/queries';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpCircle,
  Boxes,
  CircleCheck,
  CircleX,
  Clock3,
  ExternalLink,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface ToolUpdateControlsProps {
  tool: Tool;
  canUpdateTools: boolean;
}

const ROLLOUT_DISMISSAL_STORAGE_PREFIX =
  'oasm.tool-update.dismissed-rollout.v1';

/** Builds a bounded, versioned browser-storage key for one tool component. */
function rolloutDismissalStorageKey(toolId: string, component: string): string {
  return `${ROLLOUT_DISMISSAL_STORAGE_PREFIX}:${toolId}:${component}`;
}

/** Checks whether this browser dismissed the current rollout for a component. */
function isRolloutDismissed(
  toolId: string,
  component: string,
  requestId: string,
): boolean {
  try {
    return (
      window.localStorage.getItem(
        rolloutDismissalStorageKey(toolId, component),
      ) === requestId
    );
  } catch {
    return false;
  }
}

/** Persists only the latest dismissed rollout ID for a tool component. */
function rememberRolloutDismissal(
  toolId: string,
  component: string,
  requestId: string,
): void {
  try {
    window.localStorage.setItem(
      rolloutDismissalStorageKey(toolId, component),
      requestId,
    );
  } catch {
    // The in-memory dismissal still applies when browser storage is unavailable.
  }
}

function displayString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function installedLabel(versions: string[]): string {
  if (!versions.length) return 'Not reported';
  if (versions.length === 1) return versions[0];
  return `Mixed (${versions.join(', ')})`;
}

function workerStateVariant(
  state: ToolUpdateWorkerDto['state'],
): 'success' | 'destructive' | 'warning' | 'secondary' {
  if (state === 'succeeded' || state === 'ready') return 'success';
  if (state === 'failed') return 'destructive';
  if (state === 'updating') return 'warning';
  return 'secondary';
}

/** Renders update availability and the latest rollout state for one component. */
function ComponentStatus({
  component,
  canUpdateTools,
  dismissedRolloutIds,
  onConfirm,
  onDismissRollout,
  onViewRollout,
}: {
  component: ToolUpdateComponentDto;
  canUpdateTools: boolean;
  dismissedRolloutIds: ReadonlySet<string>;
  onConfirm: () => void;
  onDismissRollout: (requestId: string) => void;
  onViewRollout: () => void;
}) {
  const latestVersion = displayString(component.latestVersion);
  const releaseUrl = displayString(component.releaseUrl);
  const checkError = displayString(component.checkError);
  const rollout = component.rollout;
  const remainingWorkers = rollout ? rollout.pending + rollout.updating : 0;
  const activeRollout = Boolean(rollout && remainingWorkers > 0);
  const successfulRollout = Boolean(
    rollout &&
    rollout.totalWorkers > 0 &&
    remainingWorkers === 0 &&
    rollout.failed === 0 &&
    rollout.succeeded === rollout.totalWorkers,
  );
  const dismissedSuccessfulRollout = Boolean(
    successfulRollout && rollout && dismissedRolloutIds.has(rollout.requestId),
  );
  const completedWorkers = rollout ? rollout.succeeded + rollout.failed : 0;
  const progress = rollout?.totalWorkers
    ? (completedWorkers / rollout.totalWorkers) * 100
    : 0;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium">
            {component.displayName}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Installed {installedLabel(component.installedVersions)}</span>
            {component.mode === 'managed' && (
              <span>Latest {latestVersion ?? 'Not checked'}</span>
            )}
          </div>
        </div>
        {component.mode === 'managed' && component.updateAvailable && (
          <Badge variant="warning">
            <ArrowUpCircle /> Update available
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {component.mode === 'worker_image' && (
          <Badge variant="secondary">
            <Boxes /> Managed by worker image
          </Badge>
        )}
        {component.mode === 'external' && (
          <Badge variant="secondary">Managed by provider</Badge>
        )}
        {checkError && (
          <Badge variant="destructive" title={checkError}>
            <CircleX /> Check failed
          </Badge>
        )}
        {releaseUrl && (
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            Release notes <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {rollout &&
        !dismissedSuccessfulRollout &&
        (successfulRollout ? (
          <div className="flex items-center justify-between gap-3 border-t pt-2">
            <Badge variant="success">
              <CircleCheck /> Update complete
            </Badge>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                aria-label={`View ${component.displayName} rollout`}
                onClick={(event) => {
                  event.stopPropagation();
                  onViewRollout();
                }}
              >
                Details
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                aria-label={`Dismiss ${component.displayName} completed rollout`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDismissRollout(rollout.requestId);
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 border-t pt-2">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">
                {rollout.succeeded} succeeded · {rollout.failed} failed ·{' '}
                {remainingWorkers} remaining
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                aria-label={`View ${component.displayName} rollout`}
                onClick={(event) => {
                  event.stopPropagation();
                  onViewRollout();
                }}
              >
                Details
              </Button>
            </div>
            <Progress
              value={progress}
              aria-label={`${component.displayName} rollout progress`}
            />
          </div>
        ))}

      {canUpdateTools &&
        component.mode === 'managed' &&
        component.updateAvailable && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={activeRollout}
            aria-label={`Update ${component.displayName}`}
            onClick={(event) => {
              event.stopPropagation();
              onConfirm();
            }}
          >
            {activeRollout ? (
              <>
                <Clock3 /> Rollout in progress
              </>
            ) : rollout?.failed ? (
              <>
                <ArrowUpCircle /> Retry update
              </>
            ) : (
              <>
                <ArrowUpCircle /> Update
              </>
            )}
          </Button>
        )}
    </div>
  );
}

/** Renders all update controls and dialogs for one tool card. */
export default function ToolUpdateControls({
  tool,
  canUpdateTools,
}: ToolUpdateControlsProps) {
  const queryClient = useQueryClient();
  const components = tool.updateComponents ?? [];
  const toolStorageId = tool.id ?? tool.name;
  const [dismissedRolloutIds, setDismissedRolloutIds] = useState<Set<string>>(
    () =>
      new Set(
        components.flatMap((component) => {
          const requestId = component.rollout?.requestId;
          return requestId &&
            isRolloutDismissed(toolStorageId, component.component, requestId)
            ? [requestId]
            : [];
        }),
      ),
  );
  const [confirmation, setConfirmation] =
    useState<ToolUpdateComponentDto | null>(null);
  const [rolloutDetail, setRolloutDetail] =
    useState<ToolUpdateComponentDto | null>(null);
  const requestUpdate = useToolsControllerRequestToolUpdate({
    mutation: {
      onSuccess: async () => {
        setConfirmation(null);
        toast.success('Tool update requested');
        await queryClient.invalidateQueries({
          queryKey: getToolsControllerGetManyToolsQueryKey({}),
        });
      },
      onError: () => {
        toast.error('Unable to start the tool update');
      },
    },
  });
  if (!components.length) {
    return null;
  }

  return (
    <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
      {components.map((component) => (
        <ComponentStatus
          key={component.component}
          component={component}
          canUpdateTools={canUpdateTools}
          dismissedRolloutIds={dismissedRolloutIds}
          onConfirm={() => setConfirmation(component)}
          onDismissRollout={(requestId) => {
            rememberRolloutDismissal(
              toolStorageId,
              component.component,
              requestId,
            );
            setDismissedRolloutIds((current) => {
              const next = new Set(current);
              next.add(requestId);
              return next;
            });
          }}
          onViewRollout={() => setRolloutDetail(component)}
        />
      ))}

      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <DialogContent onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Update {confirmation?.displayName}?</DialogTitle>
            <DialogDescription>
              This starts a deployment-wide rollout of version{' '}
              {displayString(confirmation?.latestVersion) ?? 'unknown'} to all
              currently connected eligible workers. Workers wait for active jobs
              to finish, verify the release, and roll back on a failed smoke
              test.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={requestUpdate.isPending || !tool.id || !confirmation}
              onClick={() => {
                if (!tool.id || !confirmation) return;
                requestUpdate.mutate({
                  id: tool.id,
                  component: confirmation.component,
                });
              }}
            >
              {requestUpdate.isPending && <Spinner />}
              Start update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(rolloutDetail)}
        onOpenChange={(open) => !open && setRolloutDetail(null)}
      >
        <DialogContent
          className="max-h-[80vh] overflow-y-auto"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{rolloutDetail?.displayName} rollout</DialogTitle>
            <DialogDescription>
              Version {rolloutDetail?.rollout?.requestedVersion} across{' '}
              {rolloutDetail?.rollout?.totalWorkers ?? 0} eligible workers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {rolloutDetail?.rollout?.workers.map((worker) => (
              <div
                key={worker.workerId}
                className="space-y-1 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">
                    {worker.workerName}
                  </span>
                  <Badge variant={workerStateVariant(worker.state)}>
                    {worker.state === 'succeeded' && <CircleCheck />}
                    {worker.state === 'failed' && <CircleX />}
                    {worker.state}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Installed {worker.installedVersion ?? 'Not reported'} · Target{' '}
                  {worker.targetVersion ?? 'Not reported'}
                </p>
                {worker.error && (
                  <p className="text-xs text-destructive">{worker.error}</p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
