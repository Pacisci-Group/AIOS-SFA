import type { HrCalendarEntry } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { PersonSheet } from "@/features/people/sheets/PersonSheet";
import { formatDay } from "@/features/hr/policies/policy-display";
import {
  entryColor,
  entryTitle,
  hasConflict,
  LAYER_META,
  layerOf,
} from "./calendar-display";

interface DaySheetProps {
  /** `YYYY-MM-DD`. */
  date: string;
  entries: readonly HrCalendarEntry[];
  onClose: () => void;
  onEntryClick: (entry: HrCalendarEntry) => void;
  /** Set for someone who manages events: "Add event" on this day. */
  onAdd?: () => void;
}

/**
 * One day's entries, for a phone (PAC-169): the month grid there shows a
 * mark per entry and nothing to read, so tapping a day opens this list and
 * tapping a row opens the entry.
 */
export function DaySheet({
  date,
  entries,
  onClose,
  onEntryClick,
  onAdd,
}: DaySheetProps) {
  const onDay = entries.filter(
    (entry) => entry.firstDay <= date && entry.lastDay >= date,
  );
  return (
    <PersonSheet eyebrow="Calendar" title={formatDay(date)} onClose={onClose}>
      <div className="flex-1 px-6 py-5">
        {onDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on this day.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {onDay.map((entry) => {
              const Icon = LAYER_META[layerOf(entry)].icon;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onEntryClick(entry)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-foreground hover:bg-accent"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: entryColor(entry) }}
                    />
                    <Icon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {entryTitle(entry)}
                    </span>
                    {hasConflict(entry) && (
                      <span className="shrink-0 text-xs text-destructive">
                        Conflict
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {onAdd && (
        <div className="border-t border-border px-6 py-4">
          <Button variant="brand" className="w-full" onClick={onAdd}>
            Add event on this day
          </Button>
        </div>
      )}
    </PersonSheet>
  );
}
