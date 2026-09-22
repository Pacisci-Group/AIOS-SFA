import { DateRangePicker } from "@/components/common/DateRangePicker";
import type { UrlRange } from "@/lib/date-range";
import { cn } from "@/lib/utils";

/**
 * Key and label are separate fields, which is the whole point: the key is the
 * API contract, the label is text. A dashboard that uses its display string as
 * state loses its data the day someone rewords a chip.
 */
export interface RangeChip<K extends string> {
  key: K | "custom";
  label: string;
}

interface RangeChipsProps<K extends string> {
  chips: readonly RangeChip<K>[];
  range: UrlRange<K>;
  onChange: (next: UrlRange<K>) => void;
  className?: string;
}

/**
 * A dashboard's period chips, with the custom date picker wherever the list
 * puts the `custom` key.
 *
 * Extracted from the Producer dashboard's header when the Owner dashboard
 * (PAC-135) became the second strip: same control, a different set of periods.
 * The chips are wider than a phone, so the strip scrolls sideways and bleeds
 * into the page gutter to show that it does.
 */
export function RangeChips<K extends string>({
  chips,
  range,
  onChange,
  className,
}: RangeChipsProps<K>) {
  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      <div className="flex w-max items-center gap-1 rounded-lg bg-muted p-1">
        {chips.map((chip) =>
          chip.key === "custom" ? (
            <DateRangePicker
              key={chip.key}
              range={range}
              isActive={range.key === "custom"}
              onApply={(from, to) => onChange({ key: "custom", from, to })}
            />
          ) : (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange({ key: chip.key })}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs whitespace-nowrap transition-all duration-150",
                range.key === chip.key
                  ? "border-primary/20 bg-background font-semibold text-primary"
                  : "border-transparent bg-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {chip.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
