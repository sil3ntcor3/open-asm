import { type ColumnDef } from '@tanstack/react-table';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(duration);
dayjs.extend(relativeTime);

import { DataTable } from '@/components/ui/data-table';
import { DataTableError } from '@/components/ui/data-table-error-boundary';
import {
  JobStatus,
  TargetScopeType,
  TargetType,
  useTargetsControllerDiscoverTargets,
  useTargetsControllerGetTargetsInWorkspace,
} from '@/services/apis/gen/queries';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import JobStatusBadge from '@/components/ui/job-status';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { useWorkspaceState } from '@/hooks/useWorkspaceSelector';
import type { GetManyTargetResponseDto } from '@/services/apis/gen/queries';
import { Loader2Icon, Plus, Target } from 'lucide-react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { ScanStatusFilter } from './components/scan-status-filter';
import { TargetTypeFilter } from './components/target-type-filter';
import { ScopeFilter } from './components/scope-filter';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

const targetTypeColor: Record<string, string> = {
  DOMAIN: 'border-blue-400 text-blue-400',
  CIDR: 'border-emerald-400 text-emerald-400',
  IP: 'border-amber-400 text-amber-400',
};

const targetColumns: ColumnDef<GetManyTargetResponseDto>[] = [
  {
    accessorKey: 'value',
    header: 'Target',
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.getValue('value')}</span>
        {row.original.internalNetworkId && (
          <Badge variant="secondary" className="text-xs">
            Internal
          </Badge>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'type',
    header: 'Type',
    cell: ({ row }) => {
      const type = row.original.type as TargetType;
      return (
        <Badge variant="outline" className={targetTypeColor[type]}>
          {type}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'totalAssetServices',
    header: 'Services',
    cell: ({ row }) => {
      const value: string = row.getValue('totalAssetServices');
      return (
        <div className="text-muted-foreground font-medium">
          {value} services
        </div>
      );
    },
  },
  // {
  //   accessorKey: 'duration',
  //   header: 'Duration',
  //   cell: ({ row }) => {
  //     const status = row.getValue('status');
  //     if (status === 'in_progress') {
  //       return null;
  //     }

  //     const value: number = parseInt(row.getValue('duration'));
  //     const duration = dayjs.duration(value, 'seconds');
  //     const hours = duration.hours();
  //     const minutes = duration.minutes();
  //     const seconds = duration.seconds();

  //     return (
  //       <div className="text-gray-400 font-semibold">
  //         {hours > 0 && `${hours}h`}
  //         {minutes > 0 && `${minutes}m`}
  //         {seconds > 0 && `${seconds}s`}
  //       </div>
  //     );
  //   },
  // },
  {
    accessorKey: 'lastDiscoveredAt',
    header: 'Last Discovery',
    cell: ({ row }) => {
      const value: string = row.getValue('lastDiscoveredAt');
      return (
        <div className="text-muted-foreground font-medium">
          {dayjs(value).fromNow()}
        </div>
      );
    },
  },
  {
    accessorKey: 'status',
    header: 'Scan status',
    cell: ({ row }) => {
      const value: JobStatus = row.getValue('status');
      return <JobStatusBadge status={value} />;
    },
  },
];

const routeApi = getRouteApi('/_authed/targets/');

export function ListTargets() {
  const {
    state: { selectedWorkspaceId },
  } = useWorkspaceState();
  const navigate = useNavigate({ from: '/targets/' });
  const search = routeApi.useSearch();
  const queryClient = useQueryClient();
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

  // Initialize type filter from URL params
  const urlType = search.type as TargetType | undefined;
  const [typeFilter, setTypeFilter] = useState<TargetType | undefined>(
    urlType ?? undefined,
  );

  // Initialize status filter from URL params
  const urlStatus = search.status as JobStatus | undefined;
  const [statusFilter, setStatusFilter] = useState<JobStatus | undefined>(
    urlStatus ?? undefined,
  );

  // Initialize scope filter from URL params
  const urlScope = search.scope as TargetScopeType | undefined;
  const [scopeFilter, setScopeFilter] = useState<TargetScopeType | undefined>(
    (urlScope as TargetScopeType) ?? undefined,
  );

  /** Sync type filter to URL search params */
  const handleTypeFilterChange = (newType: TargetType | undefined) => {
    setTypeFilter(newType);
    navigate({
      search: ((prev: Record<string, unknown>) => ({ ...prev, type: newType || undefined })) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      replace: true,
    });
  };

  /** Sync status filter to URL search params */
  const handleStatusFilterChange = (newStatus: JobStatus | undefined) => {
    setStatusFilter(newStatus);
    navigate({
      search: ((prev: Record<string, unknown>) => ({ ...prev, status: newStatus || undefined })) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      replace: true,
    });
  };

  /** Sync scope filter to URL search params */
  const handleScopeFilterChange = (newValue: TargetScopeType | undefined) => {
    setScopeFilter(newValue);
    navigate({
      search: ((prev: Record<string, unknown>) => ({ ...prev, scope: newValue || undefined })) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      replace: true,
    });
  };

  const {
    tableParams: { page, pageSize, sortBy, sortOrder, filter },
    tableHandlers: { setPage, setPageSize, setFilter, setParams },
  } = useServerDataTable();

  const { data, isLoading, refetch } =
    useTargetsControllerGetTargetsInWorkspace(
      {
        limit: pageSize,
        page,
        sortBy,
        sortOrder,
        value: filter,
        type: typeFilter,
        status: statusFilter,
        scope: scopeFilter,
      },
      {
        query: {
          refetchInterval: 3000,
          queryKey: [
            'targets',
            selectedWorkspaceId,
            pageSize,
            page,
            sortBy,
            sortOrder,
            filter,
            typeFilter,
            statusFilter,
            scopeFilter,
          ],
        },
      },
    );
  const { mutate: discoverTargets, isPending: isStartingDiscovery } =
    useTargetsControllerDiscoverTargets();

  const targets = useMemo(() => data?.data ?? [], [data?.data]);
  const total = data?.total ?? 0;
  const selectedTargets = useMemo(
    () => targets.filter((_, index) => rowSelection[String(index)]),
    [rowSelection, targets],
  );

  useEffect(() => {
    setRowSelection({});
  }, [page, pageSize, filter, typeFilter, statusFilter, scopeFilter]);

  if (!data && !isLoading)
    return (
      <DataTableError message="Failed to load targets." onRetry={refetch} />
    );

  const handleRowClick = (target: GetManyTargetResponseDto) => {
    navigate({
      to: '/targets/$id/$tab',
      params: { id: target.id, tab: 'asset-services' },
    });
  };

  const handleStartDiscovery = () => {
    if (selectedTargets.length === 0) return;

    discoverTargets(
      {
        data: {
          targetIds: selectedTargets.map((target) => target.id),
        },
      },
      {
        onError: (error: unknown) => {
          const err = error as {
            response?: { data?: { message?: string } };
          };
          toast.error(
            err?.response?.data?.message || 'Failed to start discovery',
          );
        },
        onSuccess: (res) => {
          if (res.totalStarted > 0) {
            toast.success(
              `Discovery started on ${res.totalStarted} target${res.totalStarted > 1 ? 's' : ''}.`,
            );
          }
          if (res.totalSkipped > 0) {
            toast.info(
              `${res.totalSkipped} target${res.totalSkipped > 1 ? 's' : ''} skipped (already scanning).`,
            );
          }
          setRowSelection({});
          queryClient.refetchQueries({ queryKey: ['targets'] });
          refetch();
        },
      },
    );
  };

  return (
    <DataTable
      data={targets}
      columns={targetColumns}
      isLoading={isLoading}
      page={page}
      pageSize={pageSize}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
      onSortChange={(col, order) => {
        setParams({ sortBy: col, sortOrder: order });
      }}
      filterColumnKey="value"
      filterValue={filter}
      onFilterChange={setFilter}
      showCheckBox
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      toolbarComponents={[
        <TargetTypeFilter
          key="type-filter"
          value={typeFilter}
          onValueChange={handleTypeFilterChange}
        />,
        <ScanStatusFilter
          key="status-filter"
          value={statusFilter}
          onValueChange={handleStatusFilterChange}
        />,
        <ScopeFilter
          key="scope-filter"
          value={scopeFilter}
          onValueChange={handleScopeFilterChange}
        />,
        // <ExportDataButton api="api/targets/export" prefix="targets" />,
        <Button
          key="add-target"
          variant="outline"
          className="gap-2"
          onClick={() => navigate({ to: '/targets/add-target' })}
        >
          <Plus className="shrink-0" />
          <span>Add Target</span>
        </Button>,
        <Button
          key="start-discovery"
          variant="outline"
          className="gap-2"
          disabled={selectedTargets.length === 0 || isStartingDiscovery}
          onClick={handleStartDiscovery}
        >
          {isStartingDiscovery ? (
            <Loader2Icon className="shrink-0 animate-spin" />
          ) : (
            <Target className="shrink-0" />
          )}
          <span>Start Discovery</span>
        </Button>,
      ]}
      totalItems={total}
      onRowClick={handleRowClick}
      rowClassName="cursor-pointer hover:bg-muted/50 transition-colors"
    />
  );
}
