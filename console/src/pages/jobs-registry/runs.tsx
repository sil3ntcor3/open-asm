import type { ColumnDef } from '@tanstack/react-table';
import { Link, useNavigate, useParams } from '@tanstack/react-router';

import Page from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Image from '@/components/ui/image';
import JobStatusBadge from '@/components/ui/job-status';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import type { Job } from '@/services/apis/gen/queries';
import {
  JobStatus,
  useJobsRegistryControllerCancelJob,
  useJobsRegistryControllerDeleteJob,
  useJobsRegistryControllerGetJobHistoryDetail,
  useJobsRegistryControllerGetManyJobs,
  useJobsRegistryControllerPauseJob,
  useJobsRegistryControllerResumeJob,
} from '@/services/apis/gen/queries';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  ArrowRight,
  Calendar,
  CircleCheck,
  Clock,
  Loader2Icon,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

const getJobTitle = (row: Job) => {
  const value = row?.assetService
    ? `${row.assetService.value}`
    : row?.asset?.value;
  return value;
};

const formatTimestamp = (value?: string | Date | null) => {
  if (!value) return '-';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : '-';
};

const getJobStartedAt = (job: Job) => job.pickJobAt || job.createdAt;

const isJobTerminal = (job: Job) =>
  job.status === JobStatus.completed ||
  job.status === JobStatus.failed ||
  job.status === JobStatus.cancelled;

export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Derives the pipeline-indicator status of one workflow step (tool) from the
 * jobs of the steps before it and the jobs of the step itself.
 *
 * A previous step only holds this one at "pending" while it still has ACTIVE
 * work (running or queued). A previous step that has already finished — even
 * with some failed jobs — must not pin this step at "pending". Treating a
 * failed upstream job as "not completed" is what made nuclei render as
 * "pending" when it had in fact already run to completion, purely because the
 * screenshot step before it had failures.
 */
export function derivePipelineStepStatus(
  previousStepsJobs: { status?: string }[][],
  currentStepJobs: { status?: string }[],
): PipelineStepStatus {
  for (const prevJobs of previousStepsJobs) {
    const stillActive = prevJobs.some(
      (job) =>
        job.status === JobStatus.in_progress ||
        job.status === JobStatus.pending,
    );
    if (stillActive) return 'pending';
  }

  if (currentStepJobs.length === 0) return 'pending';
  if (currentStepJobs.some((job) => job.status === JobStatus.failed)) {
    return 'failed';
  }
  if (currentStepJobs.some((job) => job.status === JobStatus.in_progress)) {
    return 'running';
  }
  if (currentStepJobs.every((job) => job.status === JobStatus.completed)) {
    return 'completed';
  }
  if (currentStepJobs.every((job) => job.status === JobStatus.pending)) {
    return 'pending';
  }
  return 'running';
}

/** How often the run-detail view refetches while a run is still active. */
export const JOBS_POLL_INTERVAL_MS = 1000;

/**
 * True while any job is still active (queued or running). Gates the run-detail
 * polling: both the pipeline-indicator query (which feeds the pills) and the
 * job-table query refetch on an interval only while this holds, and stop once
 * every job is terminal. The pipeline pills previously froze mid-run because the
 * query feeding them was never given a refetch interval, so its snapshot — and
 * therefore this predicate, which is derived from it — stayed stuck at whatever
 * the jobs looked like when the page first loaded.
 */
export function jobsAreActive(
  jobs: { status?: string }[] | undefined,
): boolean {
  return (jobs ?? []).some(
    (job) =>
      job.status === JobStatus.in_progress ||
      job.status === JobStatus.pending,
  );
}

const getJobEndedAt = (job: Job) => {
  if (!isJobTerminal(job)) return null;
  return job.completedAt || job.updatedAt;
};

const getJobDuration = (job: Job) => {
  if (!isJobTerminal(job)) return null;

  const startedAt = dayjs(getJobStartedAt(job));
  const endedAt = dayjs(getJobEndedAt(job));

  if (!startedAt.isValid() || !endedAt.isValid()) return null;

  const totalSeconds = endedAt.diff(startedAt, 'second');
  if (totalSeconds < 0) return null;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
};

type JobActionHandler = (id: string, onSuccess: () => void) => void;

type JobActionsMenuProps = {
  job: Job;
  onActionSuccess: () => void;
  onCancel: JobActionHandler;
  onDelete: JobActionHandler;
  onPause: JobActionHandler;
  onResume: JobActionHandler;
};

function JobActionsMenu({
  job,
  onActionSuccess,
  onCancel,
  onDelete,
  onPause,
  onResume,
}: JobActionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    'cancel' | 'delete' | null
  >(null);
  const canCancel =
    job.status === JobStatus.pending || job.status === JobStatus.in_progress;
  const canPause =
    job.status === JobStatus.pending || job.status === JobStatus.in_progress;
  const canResume = job.status === JobStatus.paused;
  const isDeleteConfirm = confirmAction === 'delete';

  const runAction = (action: JobActionHandler) => {
    setMenuOpen(false);
    action(job.id, onActionSuccess);
  };
  const openConfirmation = (action: 'cancel' | 'delete') => {
    setMenuOpen(false);
    setConfirmAction(action);
  };

  return (
    <>
      <div className="flex justify-end">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="h-8 w-8 p-0 flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={(e) => e.stopPropagation()}
          >
            {canPause && (
              <DropdownMenuItem onSelect={() => runAction(onPause)}>
                Pause
              </DropdownMenuItem>
            )}
            {canResume && (
              <DropdownMenuItem onSelect={() => runAction(onResume)}>
                Resume
              </DropdownMenuItem>
            )}
            {canCancel && (
              <DropdownMenuItem onSelect={() => openConfirmation('cancel')}>
                Cancel
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => openConfirmation('delete')}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>
              {isDeleteConfirm ? 'Delete Job' : 'Cancel Job'}
            </DialogTitle>
            <DialogDescription>
              {isDeleteConfirm
                ? 'Are you sure you want to delete this job?'
                : 'Are you sure you want to cancel this job?'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant={isDeleteConfirm ? 'destructive' : 'default'}
              onClick={() => {
                if (confirmAction === 'delete') runAction(onDelete);
                if (confirmAction === 'cancel') runAction(onCancel);
                setConfirmAction(null);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Runs() {
  const { id: jobHistoryId } = useParams({ strict: false });
  const [jobError, setJobError] = useState<Job | null>();
  const queryClient = useQueryClient();

  const { mutate: deleteJobMutate } = useJobsRegistryControllerDeleteJob();
  const { mutate: cancelJobMutate } = useJobsRegistryControllerCancelJob();
  const { mutate: pauseJobMutate } = useJobsRegistryControllerPauseJob();
  const { mutate: resumeJobMutate } = useJobsRegistryControllerResumeJob();

  const { tableParams, tableHandlers } = useServerDataTable({
    defaultPage: 1,
    defaultPageSize: 10,
    defaultSortBy: 'createdAt',
    defaultSortOrder: 'DESC',
    isUpdateSearchQueryParam: false,
  });

  const { data: jobHistoryDetail } =
    useJobsRegistryControllerGetJobHistoryDetail(jobHistoryId || '', {
      query: {
        refetchInterval: 1000,
      },
    });

  // Fetch all jobs for the pipeline indicators (without pagination). This query
  // MUST poll while the run is active: the pipeline pills derive their per-step
  // status entirely from this data, so without a refetch interval they froze at
  // the page-load snapshot (e.g. "subfinder running") while nmap/httpx/etc. ran
  // to completion underneath. Poll while any job is active and stop once they
  // are all terminal; keep polling in the background so a run opened in an
  // inactive tab still advances live. The interval reads the query's own latest
  // data, so it re-evaluates after every refetch.
  const {
    data: allJobsData,
    error: allJobsError,
  } = useJobsRegistryControllerGetManyJobs({
    page: 1,
    limit: 100,
    sortBy: 'createdAt',
    sortOrder: 'ASC',
    jobHistoryId: jobHistoryId || '',
  }, {
    query: {
      refetchInterval: (query) =>
        jobsAreActive(query.state.data?.data) ? JOBS_POLL_INTERVAL_MS : false,
      refetchIntervalInBackground: true,
    },
  });

  // Whether the run still has active jobs, derived from the (now polling)
  // all-jobs snapshot. Gates the paginated table's refetch below — using the
  // global snapshot rather than the current page so polling doesn't stop just
  // because the visible page happens to hold only terminal jobs.
  const hasActiveJobs = useMemo(
    () => jobsAreActive(allJobsData?.data),
    [allJobsData?.data],
  );

  const {
    data: paginatedJobsData,
    isLoading: isLoadingJobs,
    error: jobsError,
    queryKey: paginatedJobsQueryKey,
  } = useJobsRegistryControllerGetManyJobs({
    page: tableParams.page,
    limit: tableParams.pageSize,
    sortBy: tableParams.sortBy,
    sortOrder: tableParams.sortOrder,
    jobHistoryId: jobHistoryId || '',
  }, {
    query: {
      refetchInterval: hasActiveJobs ? JOBS_POLL_INTERVAL_MS : false,
      refetchIntervalInBackground: true,
    },
  });
  const paginatedJobsQueryKeyRef = useRef(paginatedJobsQueryKey);
  paginatedJobsQueryKeyRef.current = paginatedJobsQueryKey;

  // Memoize jobs grouped by tool ID for efficient lookups, with name-based fallback
  const jobsByToolId = useMemo(() => {
    const jobs = allJobsData?.data || [];
    const byId = new Map<string, Job[]>();
    const byName = new Map<string, Job[]>();
    jobs.forEach((job) => {
      if (!job.tool) return;
      const id = job.tool.id;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id)!.push(job);
      const name = job.tool.name.toLowerCase();
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name)!.push(job);
    });
    return { byId, byName };
  }, [allJobsData?.data]);

  // Get jobs for a tool, matching by ID first then by name as fallback
  const getJobsForTool = useCallback((toolId: string, toolName?: string): Job[] => {
    if (!jobsByToolId) return [];
    const byId = jobsByToolId.byId.get(toolId);
    if (byId) return byId;
    if (toolName) {
      return jobsByToolId.byName.get(toolName.toLowerCase()) || [];
    }
    return [];
  }, [jobsByToolId]);

  const columns = useMemo<ColumnDef<Job>[]>(() => [
    {
      accessorKey: 'status',
      header: 'Target',
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-2">
            <JobStatusBadge
              onlyIcon
              status={row.original.status as JobStatus}
            />
            <pre>{getJobTitle(row.original)}</pre>
          </div>
        );
      },
    },
    {
      accessorKey: 'tool',
      header: 'Tool',
      cell: ({ row }) => (
        <div className="min-h-[60px] flex items-center">
          {row.original.tool ? (
            <Link
              to="/tools/$id" params={{ id: row.original.tool.id }}
              className="flex items-center gap-2"
            >
              <Image
                url={row.original.tool?.logoUrl}
                width={30}
                height={30}
                className="rounded-full"
              />
              <span className="capitalize font-bold">
                {row.original.tool.name}
              </span>
            </Link>
          ) : (
            <span className="text-muted-foreground">No tool assigned</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'pickJobAt',
      header: 'Started At',
      cell: ({ row }) => {
        return (
          <div className="text-sm text-muted-foreground">
            <span className="flex gap-2 items-center">
              <Calendar size={20} />
              {formatTimestamp(getJobStartedAt(row.original))}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'completedAt',
      header: 'Ended At',
      cell: ({ row }) => {
        const endedAt = getJobEndedAt(row.original);
        if (!endedAt) return null;

        return (
          <div className="text-sm text-muted-foreground">
            <span className="flex gap-2 items-center">
              <Calendar size={20} />
              {formatTimestamp(endedAt)}
            </span>
          </div>
        );
      },
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: ({ row }) => {
        const durationDisplay = getJobDuration(row.original);
        if (!durationDisplay) return null;

        return (
          <div className="text-sm text-muted-foreground">
            <span className="flex gap-2 items-center">
              <Clock size={20} />
              {durationDisplay}
            </span>
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const invalidateJobs = () => {
          queryClient.invalidateQueries({
            queryKey: [
              'JobsRegistryControllerGetJobHistoryDetail',
              jobHistoryId,
            ],
          });
          queryClient.invalidateQueries({
            queryKey: paginatedJobsQueryKeyRef.current,
          });
        };

        return (
          <JobActionsMenu
            job={row.original}
            onActionSuccess={invalidateJobs}
            onCancel={(id, onSuccess) =>
              cancelJobMutate({ id }, { onSuccess })
            }
            onDelete={(id, onSuccess) =>
              deleteJobMutate({ id }, { onSuccess })
            }
            onPause={(id, onSuccess) =>
              pauseJobMutate({ id }, { onSuccess })
            }
            onResume={(id, onSuccess) =>
              resumeJobMutate({ id }, { onSuccess })
            }
          />
        );
      },
    },
  ], [
    cancelJobMutate,
    deleteJobMutate,
    jobHistoryId,
    pauseJobMutate,
    queryClient,
    resumeJobMutate,
  ]);

  const getToolStatus = useMemo(() => {
    return (toolIndex: number): PipelineStepStatus => {
      const tools = jobHistoryDetail?.tools || [];

      const previousStepsJobs: Job[][] = [];
      for (let i = 0; i < toolIndex; i++) {
        const prevTool = tools[i];
        if (!prevTool) {
          console.warn(`Previous tool is undefined at index: ${i}`);
          continue;
        }
        previousStepsJobs.push(getJobsForTool(prevTool.id, prevTool.name));
      }

      const currentTool = tools[toolIndex];
      if (!currentTool) {
        console.warn(`Current tool is undefined at index: ${toolIndex}`);
        return 'pending';
      }
      const currentToolJobs = getJobsForTool(currentTool.id, currentTool.name);

      return derivePipelineStepStatus(previousStepsJobs, currentToolJobs);
    };
  }, [jobHistoryDetail?.tools, getJobsForTool]);

  const navigate = useNavigate();
  return (
    <Page
      isShowButtonGoBack
      title={
        jobHistoryDetail?.jobHistoryName ||
        jobHistoryDetail?.workflowName ||
        'Job History Detail'
      }
    >
      {/* Tools Section */}
      {!!jobHistoryDetail?.tools?.length && (
        <div className="mb-6 p-4 border rounded-lg bg-card">
          <h3 className="text-lg font-semibold mb-4">Pipeline</h3>
          <div className="flex items-center gap-4 flex-wrap">
            {jobHistoryDetail.tools.map((tool, index) => {
              const status = getToolStatus(index);
              return (
                <div key={tool.id} className="flex items-center gap-2">
                  <Link
                    to="/tools/$id" params={{ id: tool.id }}
                    className="flex items-center gap-2 hover:opacity-80"
                  >
                    <Image
                      url={tool.logoUrl}
                      width={40}
                      height={40}
                      className="rounded-full border"
                    />
                    <span className="font-medium">{tool.name}</span>
                    {status === 'running' && (
                      <Loader2Icon className="animate-spin" />
                    )}
                    {status === 'completed' && (
                      <CircleCheck className="text-green-500" />
                    )}
                    {status === 'pending' && (
                      <Clock className="text-yellow-500" />
                    )}
                    {status === 'failed' && <X className="text-red-500" />}
                  </Link>
                  {index < jobHistoryDetail.tools.length - 1 && (
                    <ArrowRight className="text-muted-foreground" size={16} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!!jobsError && (
        <div className="mb-4 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          Failed to load jobs. Please try again.
        </div>
      )}

      {!!allJobsError && (
        <div className="mb-4 p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          Failed to load pipeline status. Please try again.
        </div>
      )}

      <DataTable
        columns={columns}
        data={paginatedJobsData?.data || []}
        isLoading={isLoadingJobs}
        showColumnVisibility={true}
        showPagination={true}
        page={paginatedJobsData?.page || 1}
        pageSize={paginatedJobsData?.limit || 10}
        totalItems={paginatedJobsData?.total || 0}
        onPageChange={tableHandlers.setPage}
        onPageSizeChange={tableHandlers.setPageSize}
        onRowClick={(row) => {
          if (row.status === JobStatus.failed) {
            setJobError(row);
            return;
          }
          if (row.assetServiceId) {
            navigate({ to: `/assets/${row.assetServiceId}` });
          } else {
            navigate({ to: '/assets', search: { filter: row?.asset?.value } });
          }
        }}
      />
      <Dialog open={!!jobError} onOpenChange={() => setJobError(null)}>
        <DialogContent className="max-h-[80vh] flex flex-col max-w-2xl">
          <DialogHeader>
            <DialogTitle>{jobError && getJobTitle(jobError)}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-3">
            {jobError?.errorLogs?.map((errorLog, index) => (
              <div
                className="rounded-lg border bg-muted/50 p-3"
                key={errorLog.id}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Error {index + 1}
                  </span>
                </div>
                <div className="space-y-2">
                  <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                      Payload
                    </span>
                    <pre className="text-sm font-mono bg-background rounded p-2 overflow-x-auto">
                      {String(errorLog.payload).replace(/\n$/, '')}
                    </pre>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                      Message
                    </span>
                    <pre className="text-sm font-mono bg-background rounded p-2 overflow-x-auto text-destructive">
                      {String(errorLog.logMessage).replace(/\n$/, '')}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
