import { ScanScheduleSelect } from '@/components/scan-schedule-select';
import { ScanWindowSettings } from '@/components/scan-window-settings';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useWorkspaceState } from '@/hooks/useWorkspaceSelector';
import type { Target } from '@/services/apis/gen/queries';
import {
  getTargetsControllerGetTargetByIdQueryKey,
  JobStatus,
  UpdateTargetDtoScanSchedule,
  useTargetsControllerDeleteTargetFromWorkspace,
  useTargetsControllerReScanTarget,
  useTargetsControllerUpdateTarget,
} from '@/services/apis/gen/queries';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import clsx from 'clsx';
import { Clock, RefreshCw, Settings, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

const SettingTarget = ({
  target,
  refetch,
}: {
  target: Target;
  refetch: () => void;
}) => {
  const {
    state: { selectedWorkspaceId },
  } = useWorkspaceState();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentTarget, setCurrentTarget] = useState(target);
  const [frequency, setFrequency] = useState<UpdateTargetDtoScanSchedule>(
    target.scanSchedule || UpdateTargetDtoScanSchedule['0_0_*_*_0'],
  ); // Default to target's scan schedule or weekly if not set
  const [isRediscovering, setIsRediscovering] = useState(false);

  useEffect(() => {
    setCurrentTarget(target);
  }, [target]);

  // Mutation hook to delete a target from the workspace
  const { mutate: deleteTarget } =
    useTargetsControllerDeleteTargetFromWorkspace({
      mutation: {
        onSuccess: () => {
          queryClient.refetchQueries({
            queryKey: ['targets'],
          });
          setIsDeleting(false);
        },
        onError: () => setIsDeleting(false),
      },
    });

  // Mutation hook to rediscover/re-scan a target
  const { mutate: rediscoverTarget } = useTargetsControllerReScanTarget({
    mutation: {
      onSettled: () => setIsRediscovering(false),
      onError: () => setIsRediscovering(false),
      onSuccess: () => {
        refetch();
      },
    },
  });

  // Update target scan schedule / scan window
  const { mutate: updateTargetScanSchedule, isPending: isUpdatingTarget } =
    useTargetsControllerUpdateTarget({
      mutation: {
        onSuccess: (updatedTarget, variables) => {
          const nextTarget = { ...updatedTarget, ...variables.data };
          setCurrentTarget(nextTarget);
          queryClient.setQueryData(
            getTargetsControllerGetTargetByIdQueryKey(variables.id),
            nextTarget,
          );
          toast.success('Updated');
        },
        onError: () => toast.error('Failed to update target scan settings'),
      },
    });

  return (
    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="cursor-pointer h-8 w-8 rounded-full border-border/50 hover:border-border hover:bg-accent hover:text-accent-foreground"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col w-full sm:max-w-md p-0 h-full">
        <SheetHeader>
          <SheetTitle className="font-bold text-lg">
            {currentTarget.value}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col h-full">
          <div className="flex-1 space-y-0.5 overflow-y-auto p-1">
            <div className={clsx('space-y-4')}>
              <div className="space-y-2">
                <div>
                  <div className="flex items-center gap-3 p-2">
                    <div className="p-2.5 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                      <Clock className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div className="flex-1 flex items-center justify-between gap-2">
                      <label
                        htmlFor="scan-frequency"
                        className="text-sm font-medium"
                      >
                        Scan Schedule
                      </label>
                      <ScanScheduleSelect
                        value={frequency}
                        onChange={(value: UpdateTargetDtoScanSchedule) => {
                          setFrequency(value);
                          updateTargetScanSchedule({
                            id: currentTarget.id,
                            data: {
                              scanSchedule: value,
                            },
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <ScanWindowSettings
                target={currentTarget}
                isSaving={isUpdatingTarget}
                onSave={(data) =>
                  updateTargetScanSchedule({ id: currentTarget.id, data })
                }
              />

              <div className="space-y-0.5">
                <div className="space-y-1">
                  <ConfirmDialog
                    title="Re-discover target"
                    description="This will initiate a new scan of the target. The process might take a few minutes to complete."
                    onConfirm={() => {
                      setIsRediscovering(true);
                      rediscoverTarget(
                        {
                          id: currentTarget.id,
                        },
                        {
                          onError: (e) => {
                            const err = e as AxiosError<{ message: string }>;
                            toast.error(
                              err.response?.data.message ??
                                'Failed to re-discover target',
                            );
                          },
                          onSuccess: () => {
                            toast.success('Target re-discovered successfully');
                            setIsRediscovering(false);
                          },
                        },
                      );
                      navigate({
                        to: '/targets/$id/$tab',
                        params: { id: currentTarget.id, tab: 'inventory' },
                        search: { animation: 'true', page: 1, pageSize: 100 },
                      });
                      setIsSheetOpen(false);
                    }}
                    trigger={
                      <Button
                        variant="ghost"
                        className="w-full justify-start h-12 text-left p-2"
                        disabled={currentTarget.status !== JobStatus.completed}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <RefreshCw
                              className={`h-4 w-4 text-blue-600 dark:text-blue-400 ${isRediscovering ? 'animate-spin' : ''}`}
                            />
                          </div>
                          <div className="flex-1">
                            <p className="font-medium">Re-discover Target</p>
                            <p className="text-xs text-muted-foreground">
                              {currentTarget.status === JobStatus.completed
                                ? 'Scan the target again for changes'
                                : 'Target is currently being processed'}
                            </p>
                          </div>
                          {currentTarget.status !== JobStatus.completed && (
                            <Clock className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </Button>
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <SheetFooter className="p-4 mt-auto">
          <div className="flex justify-center">
            <ConfirmDialog
              title="Delete target"
              description="This action cannot be undone. This will permanently delete the target and all its data."
              onConfirm={() => {
                setIsDeleting(true);
                deleteTarget({
                  id: currentTarget.id,
                  workspaceId: selectedWorkspaceId ?? '',
                });
                window.history.back();
              }}
              typeToConfirm={currentTarget.value}
              trigger={
                <Button
                  variant="outline"
                  className="w-fit text-red-500 hover:bg-red-50 hover:text-red-600"
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin text-red-500 hover:text-red-600" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 h-4 w-4 text-red-500 hover:text-red-600" />
                      Delete Target
                    </>
                  )}
                </Button>
              }
            />
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default SettingTarget;
