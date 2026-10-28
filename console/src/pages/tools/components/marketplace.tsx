import {
  getToolsControllerGetManyToolsQueryKey,
  UserRole,
  useToolsControllerCheckForUpdates,
  useToolsControllerGetManyTools,
} from '@/services/apis/gen/queries';
import { Clock3, LayoutGrid, RefreshCw, ShieldCheck } from 'lucide-react';
import ToolsList from '../tools-list';
import ToolInstallButton from './tool-install-button';
import { useWorkspaceState } from '@/hooks/useWorkspaceSelector';
import { useSession } from '@/utils/authClient';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

function formatLastChecked(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString();
}

const Marketplace = () => {
  const {
    state: { selectedWorkspaceId },
  } = useWorkspaceState();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const canUpdateTools = session?.user.role === UserRole.admin;
  const { data, isLoading } = useToolsControllerGetManyTools(
    {},
    {
      query: {
        queryKey: [
          ...getToolsControllerGetManyToolsQueryKey({}),
          selectedWorkspaceId,
        ],
        enabled: !!selectedWorkspaceId,
        refetchInterval: 15_000,
      },
    },
  );
  const checkForUpdates = useToolsControllerCheckForUpdates({
    mutation: {
      onSuccess: async () => {
        toast.success('Official release channels checked');
        await queryClient.invalidateQueries({
          queryKey: getToolsControllerGetManyToolsQueryKey({}),
        });
      },
      onError: () => toast.error('Unable to check tool release channels'),
    },
  });
  const lastChecked = data?.data
    .flatMap((tool) => tool.updateComponents ?? [])
    .map((component) => formatLastChecked(component.lastCheckedAt))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="font-medium">Tool update management</p>
            <p className="text-sm text-muted-foreground">
              Stable release channels are checked daily. Updates always require
              an administrator to start an individual rollout.
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="size-3" />
              {lastChecked
                ? `Last checked ${lastChecked}`
                : 'Awaiting first release check'}
            </p>
          </div>
        </div>
        {canUpdateTools && (
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={checkForUpdates.isPending}
            onClick={() => checkForUpdates.mutate()}
          >
            {checkForUpdates.isPending ? <Spinner /> : <RefreshCw />}
            Check for updates
          </Button>
        )}
      </div>
      <ToolsList
        data={data?.data ?? []}
        isLoading={isLoading || !selectedWorkspaceId}
        icon={<LayoutGrid className="w-6 h-6" />}
        title="Marketplace"
        canUpdateTools={canUpdateTools}
        renderButton={(tool) => (
          <ToolInstallButton tool={tool} workspaceId={selectedWorkspaceId} />
        )}
      />
    </div>
  );
};

export default Marketplace;
