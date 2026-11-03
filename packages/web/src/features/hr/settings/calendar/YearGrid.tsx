import type { AgencyCalendarDayView, Weekday } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DAY_KIND_CELL_CLASS,
  DAY_KIND_LABELS,
  DAY_KIND_SWATCH_CLASS,
  MONTH_NAMES,
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
  daysInMonth,
  isoDate,
  weekdayOf,
} from "./calendar-display";

interface YearGridProps {
  year: number;
  workweek: readonly Weekday[];
  days: readonly AgencyCalendarDayView[];
  workingDaysByMonth: Record<string, number>;
  /** Admins click a day; everyone else just reads. */
  onPickDay?: (iso: string, existing: AgencyCalendarDayView | null) => void;
}

/**
 * Twelve month grids with the month's working-day count (PAC-161).
 *
 * Hand-rolled on purpose. The employee calendar page (PAC-169) is
 * FullCalendar; this is a picker — one glance at a year, one click to add a
 * day — and a calendar library's month view would be twelve of them.
 */
export function YearGrid({
  year,
  workweek,
  days,
  workingDaysByMonth,
  onPickDay,
}: YearGridProps) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const open = new Set(workweek);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["holiday", "closure", "special_working_day"] as const).map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5">
            <span
              className={cn("size-2.5 rounded-sm", DAY_KIND_SWATCH_CLASS[kind])}
            />
            {DAY_KIND_LABELS[kind]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-muted" />
          Not a working day
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MONTH_NAMES.map((name, index) => {
          const month = index + 1;
          const first = weekdayOf(year, month, 1);
          // Monday-first offset of the 1st.
          const lead = WEEKDAY_ORDER.indexOf(first);
          const total = daysInMonth(year, month);
          const count = workingDaysByMonth[isoDate(year, month, 1).slice(0, 7)];
          return (
            <section
              key={month}
              className="rounded-xl border border-border bg-card p-3"
              aria-label={`${name} ${year}`}
            >
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{name}</h3>
                <p className="text-xs text-muted-foreground">
                  {count ?? 0} working day{count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
                {WEEKDAY_ORDER.map((weekday) => (
                  <span
                    key={weekday}
                    className="pb-1 font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {WEEKDAY_SHORT[weekday].slice(0, 2)}
                  </span>
                ))}
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`lead-${i}`} aria-hidden />
                ))}
                {Array.from({ length: total }, (_, i) => {
                  const day = i + 1;
                  const iso = isoDate(year, month, day);
                  const row = byDate.get(iso) ?? null;
                  const weekday = weekdayOf(year, month, day);
                  const working = row
                    ? row.kind === "special_working_day"
                    : open.has(weekday);
                  const label = row
                    ? `${iso}: ${row.label} (${DAY_KIND_LABELS[row.kind]})`
                    : working
                      ? `${iso}: working day`
                      : `${iso}: not a working day`;
                  const className = cn(
                    "h-7 w-full rounded-md text-[11px] tabular-nums",
                    row
                      ? DAY_KIND_CELL_CLASS[row.kind]
                      : working
                        ? "text-foreground"
                        : "bg-muted text-muted-foreground",
                  );
                  return onPickDay ? (
                    <Button
                      key={iso}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(className, "px-0 hover:ring-1 hover:ring-ring")}
                      title={label}
                      aria-label={label}
                      onClick={() => onPickDay(iso, row)}
                    >
                      {day}
                    </Button>
                  ) : (
                    <span key={iso} className={cn(className, "leading-7")} title={label}>
                      {day}
                    </span>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
