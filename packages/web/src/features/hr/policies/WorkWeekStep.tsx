import { WEEKDAY_LABELS, type Weekday, type WorkWeekDay } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { dayHours, formatHours } from "./policy-display";

/** Monday first: a work week reads from the start of the working week. */
const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Why the schedule cannot be saved, or `null`. */
export function workWeekError(days: readonly WorkWeekDay[]): string | null {
  if (!days.length) return "Pick at least one working day.";
  const bad = days.find((day) => !(day.end > day.start));
  if (bad) return `${WEEKDAY_LABELS[bad.weekday]} must end after it starts.`;
  return null;
}

/**
 * The Work week policy's schedule: a row per weekday with an on/off switch
 * and its hours. Switching a day on copies the hours of the nearest working
 * day, so a 9-to-5 week is five clicks, not twenty fields.
 */
export function WorkWeekSchedule({
  value,
  onChange,
}: {
  value: readonly WorkWeekDay[];
  onChange: (next: WorkWeekDay[]) => void;
}) {
  const byDay = new Map(value.map((day) => [day.weekday, day]));
  const total = value.reduce((sum, day) => sum + dayHours(day), 0);
  // "Copy to all days" sits on the first working day only, not on every row.
  const firstOn = WEEK_ORDER.find((weekday) => byDay.has(weekday));

  const write = (next: Map<Weekday, WorkWeekDay>) =>
    onChange([...next.values()].sort((a, b) => a.weekday - b.weekday));

  const setDay = (weekday: Weekday, on: boolean) => {
    const next = new Map(byDay);
    if (!on) next.delete(weekday);
    else {
      const template = value[0] ?? { start: "09:00", end: "17:00" };
      next.set(weekday, { weekday, start: template.start, end: template.end });
    }
    write(next);
  };

  const setTime = (weekday: Weekday, field: "start" | "end", time: string) => {
    const current = byDay.get(weekday);
    if (!current || !time) return;
    const next = new Map(byDay);
    next.set(weekday, { ...current, [field]: time });
    write(next);
  };

  const copyToAll = (source: WorkWeekDay) => {
    const next = new Map<Weekday, WorkWeekDay>();
    for (const day of value) {
      next.set(day.weekday, { ...day, start: source.start, end: source.end });
    }
    write(next);
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h3 className="text-base font-semibold text-card-foreground">Working days and hours</h3>
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatHours(total)} a week
        </span>
      </div>
      <ul className="divide-y divide-border">
        {WEEK_ORDER.map((weekday) => {
          const day = byDay.get(weekday);
          const id = `weekday-${weekday}`;
          const invalid = day ? !(day.end > day.start) : false;
          return (
            <li key={weekday} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Switch
                id={id}
                checked={Boolean(day)}
                onCheckedChange={(on) => setDay(weekday, on)}
              />
              <label
                htmlFor={id}
                className={cn(
                  "w-24 text-base",
                  !day && "text-muted-foreground",
                )}
              >
                {WEEKDAY_LABELS[weekday]}
              </label>
              {day ? (
                <>
                  <Input
                    type="time"
                    aria-label={`${WEEKDAY_LABELS[weekday]} start`}
                    value={day.start}
                    onChange={(event) => setTime(weekday, "start", event.target.value)}
                    className="w-32"
                    aria-invalid={invalid}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    aria-label={`${WEEKDAY_LABELS[weekday]} end`}
                    value={day.end}
                    onChange={(event) => setTime(weekday, "end", event.target.value)}
                    className="w-32"
                    aria-invalid={invalid}
                  />
                  <span className="w-12 text-sm tabular-nums text-muted-foreground">
                    {formatHours(dayHours(day))}
                  </span>
                  {value.length > 1 && weekday === firstOn && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="ml-auto"
                      onClick={() => copyToAll(day)}
                    >
                      Copy to all days
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">Day off</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
