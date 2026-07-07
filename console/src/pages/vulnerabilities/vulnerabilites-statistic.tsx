import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import {
  useVulnerabilitiesControllerGetVulnerabilitiesStatistics,
  VulnerabilitiesControllerGetVulnerabilitiesSeverityItem,
  VulnerabilitiesControllerGetVulnerabilitiesStatus,
} from '@/services/apis/gen/queries';
import clsx from 'clsx';
import { useSearch } from '@tanstack/react-router';

interface VulnerabilitiesStatisticProps {
  targetId?: string;
}

const getFirstSearchValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const VulnerabilitiesStatistic = ({
  targetId,
}: VulnerabilitiesStatisticProps) => {
  const { selectedWorkspace } = useWorkspaceSelector();
  const search = useSearch({ strict: false }) as Record<
    string,
    string | string[] | undefined
  >;

  // Use targetId from props if provided, otherwise use from URL
  const effectiveTargetId = targetId || getFirstSearchValue(search.targetId);
  const targetFilter = getFirstSearchValue(search.targetIdFilter);
  const filter = getFirstSearchValue(search.filter);
  const createdFrom = getFirstSearchValue(search.createdFrom);
  const createdTo = getFirstSearchValue(search.createdTo);

  const urlStatus = getFirstSearchValue(search.status) as
    | VulnerabilitiesControllerGetVulnerabilitiesStatus
    | undefined;
  const status =
    urlStatus &&
    Object.values(VulnerabilitiesControllerGetVulnerabilitiesStatus).includes(
      urlStatus,
    )
      ? urlStatus
      : VulnerabilitiesControllerGetVulnerabilitiesStatus.open;

  const urlSeverity = search.severity;
  const severity = (
    urlSeverity
      ? Array.isArray(urlSeverity)
        ? urlSeverity
        : urlSeverity.split(',')
      : []
  ).filter(
    (item): item is VulnerabilitiesControllerGetVulnerabilitiesSeverityItem =>
      Object.values(
        VulnerabilitiesControllerGetVulnerabilitiesSeverityItem,
      ).includes(
        item as VulnerabilitiesControllerGetVulnerabilitiesSeverityItem,
      ),
  );

  const urlTags = search.tags;
  const tags = (
    urlTags ? (Array.isArray(urlTags) ? urlTags : urlTags.split(',')) : []
  ).filter((item) => item.trim() !== '');

  const { data, isLoading } =
    useVulnerabilitiesControllerGetVulnerabilitiesStatistics(
      {
        workspaceId: selectedWorkspace ?? '',
        targetIds: effectiveTargetId ? [effectiveTargetId] : undefined,
        status,
        severity: severity.length > 0 ? severity : undefined,
        createdFrom,
        createdTo,
        tags: tags.length > 0 ? tags : undefined,
        targetId: targetFilter || undefined,
        q: filter || undefined,
      },
      {
        query: {
          enabled: !!selectedWorkspace,
          refetchInterval: 5000,
        },
      },
    );

  // Create a map of severity to count for easy access
  const severityCounts = data?.data?.reduce(
    (acc, item) => {
      acc[item.severity] = item.count;
      return acc;
    },
    {} as Record<string, number>,
  ) || {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  // Loading state - show skeleton
  if (isLoading) {
    return (
      <div className="flex items-center gap-12">
        {[...Array(5)].map((_, index) => (
          <div key={index} className="flex flex-col animate-pulse">
            <div className="h-4 bg-muted rounded w-16 mb-1"></div>
            <div className="h-8 bg-muted rounded w-8"></div>
          </div>
        ))}
      </div>
    );
  }

  const severityConfig = [
    { key: 'critical', label: 'Critical', color: 'text-red-500' },
    { key: 'high', label: 'High', color: 'text-orange-500' },
    { key: 'medium', label: 'Medium', color: 'text-yellow-500' },
    { key: 'low', label: 'Low', color: 'text-blue-500' },
    { key: 'info', label: 'Info', color: '' },
  ];

  return (
    <div className="flex items-center gap-12">
      {severityConfig.map(({ key, label, color }) => (
        <div key={key} className="flex flex-col">
          <span className="text-muted-foreground text-sm">{label}</span>
          <span className={clsx('text-2xl font-bold ', color)}>
            {severityCounts[key]}
          </span>
        </div>
      ))}
    </div>
  );
};

export default VulnerabilitiesStatistic;
