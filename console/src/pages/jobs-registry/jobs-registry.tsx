import Page from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
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
import JobStatusBadge from '@/components/ui/job-status';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import {
  type JobHistoryResponseDto,
  JobStatus,
  useJobsRegistryControllerCancelJobHistoryJobs,
  useJobsRegistryControllerDeleteJobHistoryJobs,
  useJobsRegistryControllerGetManyJobHistories,
  useJobsRegistryControllerPauseJobHistoryJobs,
  useJobsRegistryControllerResumeJobHistoryJobs,
} from '@/services/apis/gen/queries';
import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import dayjs from 'dayjs';
import { Calendar, MoreHorizontal } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

const formatTimestamp = (value?: string | Date | null) => {
  if (!value) return '-';
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : '-';
};

const JOB_HISTORIES_REFETCH_INTERVAL_MS = 3000;

type JobHistoryActionHandler = (id: string, onSuccess: () => void) => void;

type JobHistoryActionsMenuProps = {
  jobHistory: JobHistoryResponseDto;
  onActionSuccess: () => void;
  onCancel: JobHistoryActionHandler;
  onDelete: JobHistoryActionHandler;
  onPause: JobHistoryActionHandler;
  onResume: JobHistoryActionHandler;
};

function JobHistoryActionsMenu({
  jobHistory,
  onActionSuccess,
  onCancel,
  onDelete,
  onPause,
  onResume,
}: JobHistoryActionsMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    'cancel' | 'delete' | null
  >(null);
  const canPause = jobHistory.pauseEligibleJobs > 0;
  const canResume = jobHistory.resumeEligibleJobs > 0;
  const canCancel = jobHistory.cancelEligibleJobs > 0;
  const isDeleteConfirm = confirmAction === 'delete';

  const runAction = (action: JobHistoryActionHandler) => {
    setMenuOpen(false);
    action(jobHistory.id, onActionSuccess);
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
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
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
              {isDeleteConfirm ? 'Delete Jobs' : 'Cancel Jobs'}
            </DialogTitle>
            <DialogDescription>
              {isDeleteConfirm
                ? 'Delete all jobs under this registry entry. Assets and scan outputs will not be deleted.'
                : 'Cancel all eligible jobs under this registry entry. Completed and failed jobs will be skipped.'}
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

const JobsRegistryPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mutate: deleteJobHistoryJobsMutate } =
    useJobsRegistryControllerDeleteJobHistoryJobs();
  const { mutate: cancelJobHistoryJobsMutate } =
    useJobsRegistryControllerCancelJobHistoryJobs();
  const { mutate: pauseJobHistoryJobsMutate } =
    useJobsRegistryControllerPauseJobHistoryJobs();
  const { mutate: resumeJobHistoryJobsMutate } =
    useJobsRegistryControllerResumeJobHistoryJobs();
  const {
    tableParams: { page, pageSize, sortBy, sortOrder },
    tableHandlers: { setPage, setPageSize, setParams },
  } = useServerDataTable();

  const {
    data: jobsData,
    isLoading,
    isError,
    error,
    queryKey: jobHistoriesQueryKey,
  } = useJobsRegistryControllerGetManyJobHistories(
    {
      page,
      limit: pageSize,
      sortBy,
      sortOrder,
    },
    {
      query: {
        enabled: true,
        refetchInterval: JOB_HISTORIES_REFETCH_INTERVAL_MS,
        refetchOnMount: 'always',
        staleTime: 0,
      },
    },
  );
  const jobHistoriesQueryKeyRef = useRef(jobHistoriesQueryKey);
  jobHistoriesQueryKeyRef.current = jobHistoriesQueryKey;

  const columns = useMemo<ColumnDef<JobHistoryResponseDto>[]>(
    () => [
      {
        accessorKey: 'status',
        header: 'Job',
        cell: ({ row }) => {
          return (
            <div className="flex items-center gap-2">
              <JobStatusBadge
                onlyIcon
                status={row.original.status as JobStatus}
              />
              <pre>
                {row.original?.jobHistoryName ||
                  row.original?.workflowName ||
                  'Manual run'}
              </pre>
            </div>
          );
        },
      },
      {
        accessorKey: 'totalJobs',
        header: 'Total jobs',
        cell: ({ row }) => {
          return (
            <div>
              <b>{row.original.totalJobs}</b> jobs
            </div>
          );
        },
      },
      {
        accessorKey: 'createdAt',
        header: 'Started At',
        cell: ({ row }) => {
          const job = row.original;
          return (
            <div className="flex flex-col text-muted-foreground text-xs gap-3">
              <span className="flex items-center gap-1">
                <Calendar size={20} />
                {formatTimestamp(job.createdAt)}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'updatedAt',
        header: 'Ended At',
        cell: ({ row }) => {
          const job = row.original;
          if (
            job.status !== JobStatus.completed &&
            job.status !== JobStatus.failed &&
            job.status !== JobStatus.cancelled
          ) {
            return null;
          }

          return (
            <div className="flex flex-col text-muted-foreground text-xs gap-3">
              <span className="flex items-center gap-1">
                <Calendar size={20} />
                {formatTimestamp(job.updatedAt)}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'jobRunType',
        header: 'Run Type',
        cell: ({ row }) => {
          return (
            <Badge variant="outline">
              <span className="text-xs font-medium capitalize">
                {row.original?.jobRunType || 'manual'}
              </span>
            </Badge>
          );
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const invalidateJobs = () => {
            const queryKey = jobHistoriesQueryKeyRef.current;
            if (queryKey) {
              queryClient.invalidateQueries({ queryKey });
              return;
            }
            queryClient.invalidateQueries({
              queryKey: ['/api/jobs-registry/histories'],
            });
          };

          return (
            <JobHistoryActionsMenu
              jobHistory={row.original}
              onActionSuccess={invalidateJobs}
              onCancel={(id, onSuccess) =>
                cancelJobHistoryJobsMutate({ id }, { onSuccess })
              }
              onDelete={(id, onSuccess) =>
                deleteJobHistoryJobsMutate({ id }, { onSuccess })
              }
              onPause={(id, onSuccess) =>
                pauseJobHistoryJobsMutate({ id }, { onSuccess })
              }
              onResume={(id, onSuccess) =>
                resumeJobHistoryJobsMutate({ id }, { onSuccess })
              }
            />
          );
        },
      },
    ],
    [
      cancelJobHistoryJobsMutate,
      deleteJobHistoryJobsMutate,
      pauseJobHistoryJobsMutate,
      queryClient,
      resumeJobHistoryJobsMutate,
    ],
  );

  if (isError) {
    return (
      <div className="p-4">
        <div className="text-destructive">
          Error:{' '}
          {error instanceof Error ? error.message : 'Failed to load jobs'}
        </div>
      </div>
    );
  }

  return (
    <Page title="Jobs Registry">
      <DataTable
        columns={columns}
        data={jobsData?.data || []}
        isLoading={isLoading}
        page={jobsData?.page ?? page}
        pageSize={jobsData?.limit ?? pageSize}
        totalItems={jobsData?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(col, order) => {
          setParams({ sortBy: col, sortOrder: order, page: 1 });
        }}
        showPagination={true}
        onRowClick={(row) => {
          navigate({ to: `/jobs/runs/${row.id}` });
        }}
      />
    </Page>
  );
};

export default JobsRegistryPage;
