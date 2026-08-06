import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatRangeLabel } from "../dashboard-range";
import type { DashboardRange } from "../useDashboardRange";

/** Mirrors `MAX_CUSTOM_SPAN_DAYS` on the API, which rejects anything larger. */
const MAX_SPAN_DAYS = 366;

interface DateRangePickerProps {
  range: DashboardRange;
  onApply: (from: string, to: string) => void;
  isActive: boolean;
}

/** A local `Date` → `YYYY-MM-DD`, using the calendar day the user clicked. */
function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromIsoDate(iso?: string): Date | undefined {
  if (!iso) return undefined;
  // Noon avoids the DST hour where midnight-local can land on the prior day.
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function spanDays(from: Date, to: Date): number {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.floor((startOfDay(to) - startOfDay(from)) / 86_400_000) + 1;
}

/**
 * The 📅 Custom Date chip and its picker (PAC-9).
 *
 * Apply is explicit rather than applying on selection: `mode="range"` reports a
 * half-finished selection after the first click (`from` set, `to` undefined),
 * and firing a request for a one-day window the user did not ask for would make
 * every custom range flash the wrong numbers on the way to the right ones.
 */
export function DateRangePicker({
  range,
  onApply,
  isActive,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  // Re-seed the draft each time the popover opens, so it always starts from
  // what is actually applied rather than an abandoned earlier selection.
  useEffect(() => {
    if (!open) return;
    setDraft({
      from: fromIsoDate(range.from),
      to: fromIsoDate(range.to),
    });
  }, [open, range.from, range.to]);

  const from = draft?.from;
  const to = draft?.to;
  const span = from && to ? spanDays(from, to) : 0;
  const tooLong = span > MAX_SPAN_DAYS;
  const canApply = Boolean(from && to) && !tooLong;

  const label =
    isActive && range.from && range.to
      ? formatRangeLabel(range.from, range.to)
      : "Custom Date";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-all duration-150",
            isActive
              ? "border-primary/20 bg-background font-semibold text-primary"
              : "border-transparent bg-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <CalendarDays size={12} />
          {label}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={2}
          defaultMonth={from}
          selected={draft}
          onSelect={setDraft}
          autoFocus
        />

        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
          <p
            className={cn(
              "text-xs",
              tooLong ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {tooLong
              ? `Pick at most ${MAX_SPAN_DAYS} days.`
              : from && to
                ? `${span} day${span === 1 ? "" : "s"}`
                : "Pick a start and end date."}
          </p>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(undefined)}
              disabled={!from && !to}
            >
              Clear
            </Button>
            <Button
              size="sm"
              disabled={!canApply}
              onClick={() => {
                if (!from || !to) return;
                onApply(toIsoDate(from), toIsoDate(to));
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
