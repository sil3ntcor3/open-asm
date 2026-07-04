import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { Target, UpdateTargetDto } from '@/services/apis/gen/queries';
import { CalendarClock } from 'lucide-react';
import { useMemo, useState } from 'react';

// ISO weekday numbering (1 = Monday … 7 = Sunday) to match the backend.
const WEEK_DAYS: { iso: number; label: string }[] = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
];

/** Best-effort list of IANA timezones with graceful fallback. */
const getTimezones = (): string[] => {
  try {
    const withValues = Intl as unknown as {
      supportedValuesOf?: (key: string) => string[];
    };
    if (typeof withValues.supportedValuesOf === 'function') {
      return withValues.supportedValuesOf('timeZone');
    }
  } catch {
    /* fall through to fallback list */
  }
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
};

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

interface ScanWindowSettingsProps {
  target: Target;
  onSave: (data: UpdateTargetDto) => void;
  isSaving?: boolean;
}

/**
 * Configures a target's scan execution window: jobs for this target are only
 * dispatched to workers while the window is open. Disabling the window
 * (clearing start/end) returns the target to continuous scanning.
 */
export const ScanWindowSettings = ({
  target,
  onSave,
  isSaving,
}: ScanWindowSettingsProps) => {
  const timezones = useMemo(getTimezones, []);

  const initiallyEnabled = !!(target.scanWindowStart && target.scanWindowEnd);
  const [enabled, setEnabled] = useState(initiallyEnabled);
  // <input type="time"> works in HH:MM; the API stores HH:MM(:SS). Trim to HH:MM.
  const [start, setStart] = useState(
    target.scanWindowStart?.slice(0, 5) ?? '22:00',
  );
  const [end, setEnd] = useState(target.scanWindowEnd?.slice(0, 5) ?? '06:00');
  const [timezone, setTimezone] = useState(
    target.scanWindowTimezone ?? browserTimezone(),
  );
  const [days, setDays] = useState<number[]>(target.scanWindowDays ?? []);

  const clearScanWindow = () => {
    onSave({
      scanWindowStart: null,
      scanWindowEnd: null,
      scanWindowTimezone: null,
      scanWindowDays: null,
    });
  };

  const handleEnabledChange = (checked: boolean) => {
    setEnabled(checked);

    if (!checked) {
      clearScanWindow();
    }
  };

  const toggleDay = (iso: number) => {
    setDays((prev) =>
      prev.includes(iso)
        ? prev.filter((d) => d !== iso)
        : [...prev, iso].sort((a, b) => a - b),
    );
  };

  const handleSave = () => {
    onSave({
      scanWindowStart: start,
      scanWindowEnd: end,
      scanWindowTimezone: timezone,
      scanWindowDays: days.length > 0 ? days : null,
    });
  };

  const crossesMidnight = enabled && start > end;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <CalendarClock className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <p className="text-sm font-medium">Scan Window</p>
            <p className="text-xs text-muted-foreground">
              Only scan during set hours
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleEnabledChange}
          aria-label="Enable scan window"
          disabled={isSaving}
        />
      </div>

      {enabled && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="scan-window-start" className="text-xs">
                Start
              </Label>
              <Input
                id="scan-window-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="scan-window-end" className="text-xs">
                End
              </Label>
              <Input
                id="scan-window-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          {crossesMidnight && (
            <p className="text-xs text-muted-foreground">
              Window runs overnight ({start} → {end} next day).
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="scan-window-tz" className="text-xs">
              Timezone
            </Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="scan-window-tz" className="w-full h-9 text-sm">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {timezones.map((tz) => (
                  <SelectItem key={tz} value={tz} className="cursor-pointer">
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Days of week</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEK_DAYS.map((d) => {
                const active = days.includes(d.iso);
                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => toggleDay(d.iso)}
                    className={`h-8 w-10 rounded-md border text-xs font-medium transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Leave all unselected to run every day.
            </p>
          </div>
        </div>
      )}

      {enabled && (
        <Button
          size="sm"
          className="w-full"
          onClick={handleSave}
          disabled={isSaving}
        >
          Save scan window
        </Button>
      )}
    </div>
  );
};

export default ScanWindowSettings;
