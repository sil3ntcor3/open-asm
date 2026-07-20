import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getRootControllerGetLatestVersionQueryKey,
  useRootControllerCheckForUpdates,
  useRootControllerGetLatestVersion,
} from '@/services/apis/gen/queries';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleCheckBig,
  ExternalLink,
  Loader2Icon,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

const formatDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'Not checked yet';

export default function GetAboutProject() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useRootControllerGetLatestVersion();
  const { mutate: checkForUpdates, isPending } =
    useRootControllerCheckForUpdates({
      mutation: {
        onSuccess: (version) => {
          queryClient.setQueryData(
            getRootControllerGetLatestVersionQueryKey(),
            version,
          );
          toast.success('Update check completed.');
        },
        onError: () => {
          toast.error('Unable to check for updates.');
        },
      },
    });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const status = isError
    ? 'unavailable'
    : data?.isLatest === true
      ? 'current'
      : data?.isLatest === false
        ? 'available'
        : 'unavailable';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Version</CardTitle>
              <CardDescription>
                Installed build and stable release status
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => checkForUpdates()}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Check for updates
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-3">
            {status === 'current' ? (
              <CircleCheckBig className="mt-0.5 h-5 w-5 text-green-600" />
            ) : (
              <TriangleAlert className="mt-0.5 h-5 w-5 text-orange-500" />
            )}
            <div className="space-y-1">
              <p className="font-medium">
                {status === 'current'
                  ? 'Platform is up to date'
                  : status === 'available'
                    ? 'A newer stable release is available'
                    : 'Update status is unavailable'}
              </p>
              <p className="text-sm text-muted-foreground">
                Last checked {formatDate(data?.lastCheckedAt)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Installed version
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm">
                  {data?.currentVersion || 'Unknown'}
                </p>
                {data?.channel && (
                  <Badge variant="secondary">
                    {data.channel === 'dev'
                      ? 'Development channel'
                      : `${data.channel} channel`}
                  </Badge>
                )}
              </div>
              {data?.currentCommit && (
                <p className="text-xs text-muted-foreground">
                  Commit {data.currentCommit}
                </p>
              )}
            </div>

            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Latest stable release
              </p>
              <p className="font-mono text-sm">
                {data?.latestVersion || 'Unavailable'}
              </p>
              <p className="text-xs text-muted-foreground">
                {data?.releaseDate
                  ? `Released ${formatDate(data.releaseDate)}`
                  : 'Release date unavailable'}
              </p>
            </div>
          </div>

          {data?.releaseUrl && (
            <Button asChild variant="outline" size="sm">
              <a target="_blank" rel="noreferrer" href={data.releaseUrl}>
                View release
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <a
        target="_blank"
        rel="noreferrer"
        href="https://github.com/oasm-platform/open-asm/blob/main/LICENSE"
      >
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardTitle>License</CardTitle>
            <CardDescription>GPL-3.0 license</CardDescription>
          </CardHeader>
        </Card>
      </a>
    </div>
  );
}
