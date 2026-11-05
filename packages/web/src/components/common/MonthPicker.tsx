import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addMonths, formatMonth, recentMonths } from "@/lib/months";
import { cn } from "@/lib/utils";

interface MonthPickerProps {
  /** `YYYY-MM`. */
  value: string;
  onChange: (month: string) => void;
  /** The latest month that may be picked — usually the agency's current one. */
  max: string;
  /** How many months back the list goes. */
  span?: number;
  /** The accessible name of the list. */
  label?: string;
  className?: string;
}

/**
 * One calendar month: step with the arrows, or jump from the list. The
 * Payouts pages' period (PAC-178) — a statement is a month, so a date range
 * would only offer ways to ask for something that does not exist.
 */
export function MonthPicker({
  value,
  onChange,
  max,
  span = 24,
  label = "Month",
  className,
}: MonthPickerProps) {
  const months = recentMonths(max, span);
  const min = months[months.length - 1];
  // A month outside the list (an old link) is still shown, and listed.
  const options = months.includes(value) ? months : [value, ...months];

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Previous month"
        disabled={value <= min}
        onClick={() => onChange(addMonths(value, -1))}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-44 bg-card" aria-label={label}>
          <SelectValue>{formatMonth(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((month) => (
            <SelectItem key={month} value={month}>
              {formatMonth(month)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Next month"
        disabled={value >= max}
        onClick={() => onChange(addMonths(value, 1))}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}
