import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import {
  useWorkersControllerUpdateWorkerSettings,
  type WorkerInstance,
} from '@/services/apis/gen/queries';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { Loader2Icon, PauseCircle, PlayCircle, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Per-worker runtime control: pause/resume the whole worker and set its
 * desired max concurrency. Both are applied by the worker on its next
 * control poll; shrinking concurrency never kills running jobs.
 */
const WorkerSettingsControl = ({ worker }: { worker: WorkerInstance }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Local draft of the concurrency input; empty string = "use worker default".
  const [concurrency, setConcurrency] = useState<string>(
    worker.maxConcurrency != null ? String(worker.maxConcurrency) : '',
  );

  // Keep the draft in sync when the polled worker data changes while closed.
  useEffect(() => {
    if (!open) {
      setConcurrency(
        worker.maxConcurrency != null ? String(worker.maxConcurrency) : '',
      );
    }
  }, [worker.maxConcurrency, open]);

  const { mutate: updateSettings, isPending } =
    useWorkersControllerUpdateWorkerSettings({
      mutation: {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: ['WorkersControllerGetWorkers'],
          });
        },
        onError: (e) => {
          const err = e as AxiosError<{ message?: string }>;
          toast.error(err.response?.data?.message ?? 'Failed to update worker');
        },
      },
    });

  const isPaused = worker.isPaused === true;

  const togglePause = () => {
    updateSettings(
      { id: worker.id, data: { isPaused: !isPaused } },
      {
        onSuccess: () =>
          toast.success(isPaused ? 'Worker resumed' : 'Worker paused'),
      },
    );
  };

  const saveConcurrency = () => {
    const trimmed = concurrency.trim();
    // Empty resets to the worker's local default (null).
    if (trimmed === '') {
      updateSettings(
        { id: worker.id, data: { maxConcurrency: null } },
        { onSuccess: () => toast.success('Concurrency reset to worker default') },
      );
      return;
    }
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      toast.error('Concurrency must be a whole number between 1 and 100');
      return;
    }
    updateSettings(
      { id: worker.id, data: { maxConcurrency: value } },
      { onSuccess: () => toast.success(`Concurrency set to ${value}`) },
    );
  };

  return (
    <div className="flex items-center gap-1">
      {isPaused && (
        <span className="text-xs font-medium text-orange-500">Paused</span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title={isPaused ? 'Resume worker' : 'Pause worker'}
        onClick={(e) => {
          e.stopPropagation();
          togglePause();
        }}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2Icon className="h-4 w-4 animate-spin" />
        ) : isPaused ? (
          <PlayCircle className="h-4 w-4 text-green-600" />
        ) : (
          <PauseCircle className="h-4 w-4 text-orange-500" />
        )}
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Worker settings"
            onClick={(e) => e.stopPropagation()}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-72 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Worker settings</h4>
            <p className="text-xs text-muted-foreground">
              Changes apply on the worker&apos;s next poll. Reducing concurrency
              never stops running jobs.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor={`pause-${worker.id}`} className="text-sm">
                Pause worker
              </Label>
              <p className="text-xs text-muted-foreground">
                Stop handing it new jobs
              </p>
            </div>
            <Switch
              id={`pause-${worker.id}`}
              checked={isPaused}
              onCheckedChange={togglePause}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`concurrency-${worker.id}`} className="text-sm">
              Max concurrent jobs
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`concurrency-${worker.id}`}
                type="number"
                min={1}
                max={100}
                placeholder="Default"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
              />
              <Button
                size="sm"
                onClick={saveConcurrency}
                disabled={isPending}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave blank to use the worker&apos;s configured default.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default WorkerSettingsControl;
