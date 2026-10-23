import { weeklyMinutes, type Weekday, type WorkSchedule } from "@sfa/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { WEEKDAY_ORDER, WEEKDAY_SHORT } from "../settings/calendar/calendar-display";

interface ScheduleEditorProps {
  value: WorkSchedule;
  onChange: (next: WorkSchedule) => void;
  disabled?: boolean;
  /**
   * The schedule the person falls back to for a day left off — the template
   * or the agency workweek. Shown greyed under an unticked day so "Friday
   * off" and "Friday as the template says" read differently.
   */
  fallback?: WorkSchedule | null;
  idPrefix: string;
  className?: string;
}

/**
 * A seven-row weekly schedule (PAC-162): tick a day to give it a shift,
 * untick it for a day off. Shared by the Schedules tab (where it edits a
 * template) and the employee page (where it edits an override over one).
 *
 * `'HH:mm'` strings on the agency's clock, exactly as stored; no `Date`
 * ever touches them, so the browser's zone cannot shift a shift.
 */
export function ScheduleEditor({
  value,
  onChange,
  disabled,
  fallback,
  idPrefix,
  className,
}: ScheduleEditorProps) {
  const setDay = (day: Weekday, shift: WorkSchedule[Weekday] | undefined) => {
    const next: WorkSchedule = { ...value };
    if (shift === undefined) delete next[day];
    else next[day] = shift;
    onChange(next);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {WEEKDAY_ORDER.map((day) => {
        const shift = value[day];
        const on = Boolean(shift);
        const inherited = fallback?.[day] ?? null;
        const id = `${idPrefix}-${day}`;
        return (
          <div
            key={day}
            className="grid grid-cols-[5.5rem_1fr] items-center gap-3 sm:grid-cols-[6rem_1fr_auto]"
          >
            <div className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={on}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  setDay(
                    day,
                    checked === true
                      ? (inherited ?? { start: "09:00", end: "17:00" })
                      : null,
                  )
                }
              />
              <Label htmlFor={id} className="font-normal">
                {WEEKDAY_SHORT[day]}
              </Label>
            </div>
            {on && shift ? (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  aria-label={`${WEEKDAY_SHORT[day]} start`}
                  value={shift.start}
                  disabled={disabled}
                  className="w-28 bg-card border-border"
                  onChange={(e) => setDay(day, { ...shift, start: e.target.value })}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label={`${WEEKDAY_SHORT[day]} end`}
                  value={shift.end}
                  disabled={disabled}
                  className="w-28 bg-card border-border"
                  onChange={(e) => setDay(day, { ...shift, end: e.target.value })}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {inherited && !on && value[day] === undefined
                  ? `${inherited.start}–${inherited.end} (as the template says)`
                  : "Off"}
              </p>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatWeeklyHours(weeklyMinutes(value))} per week
      </p>
    </div>
  );
}

export function formatWeeklyHours(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** `'09:00–17:00'` per day, Monday first, for a read-only summary. */
export function scheduleLines(schedule: WorkSchedule): { day: Weekday; text: string }[] {
  return WEEKDAY_ORDER.map((day) => {
    const shift = schedule[day];
    return { day, text: shift ? `${shift.start}–${shift.end}` : "Off" };
  });
}
