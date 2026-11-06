import { useMemo } from "react";
import type {
  DateSelectInfo,
  DatesSetInfo,
  EventClickInfo,
} from "@fullcalendar/react";
import { useTheme } from "next-themes";
import { fromExclusiveEnd, type HrCalendarEntry } from "@sfa/shared";
import { EventCalendar } from "@/components/event-calendar";
import { cn } from "@/lib/utils";
import { hasConflict, toCalendarEvent } from "./calendar-display";

export interface CalendarRange {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
}

interface HrCalendarProps {
  entries: readonly HrCalendarEntry[];
  /** Today on the agency's calendar, `YYYY-MM-DD`. */
  today: string;
  /** Opens on the list on a phone: a month grid of seven columns is unreadable there. */
  compact: boolean;
  onRangeChange: (range: CalendarRange) => void;
  onEntryClick: (entry: HrCalendarEntry) => void;
  /** Set for someone who manages events: the toolbar button and day selection. */
  onAdd?: (range?: CalendarRange) => void;
}

const VIEWS = ["dayGridMonth", "dayGridWeek", "listMonth"];
const COMPACT_VIEWS = ["listMonth", "dayGridMonth", "dayGridWeek"];

/**
 * The one place FullCalendar is used (PAC-169) — the exception recorded in
 * `packages/web/CLAUDE.md`. Everything it is handed is plain data: entries
 * mapped by `calendar-display.ts`, colours as `theme.css` tokens.
 *
 * ## Whole days, no zone
 *
 * Every entry is a `YYYY-MM-DD` range on the agency's calendar, so the
 * calendar runs in `timeZone="UTC"` and only ever reads the **string** forms
 * of the dates it reports (`startStr`, `endStr`). A `Date` object here would
 * be the reader's local midnight, which is the wrong day for half the world.
 * "Today" is handed in for the same reason: it is the agency's today, not
 * the browser's.
 *
 * ## The week is a day grid
 *
 * `dayGridWeek`, not a time grid: nothing on this calendar has a duration in
 * hours — an event's time is shown in its title — so an hour grid would be
 * an empty column of lines.
 */
export function HrCalendar({
  entries,
  today,
  compact,
  onRangeChange,
  onEntryClick,
  onAdd,
}: HrCalendarProps) {
  const { resolvedTheme } = useTheme();
  // A new array every render would make FullCalendar re-read its events and
  // fire `datesSet` again: keep the identity tied to the entries.
  const events = useMemo(() => entries.map(toCalendarEvent), [entries]);

  return (
    <EventCalendar
      className="rounded-xl"
      availableViews={compact ? COMPACT_VIEWS : VIEWS}
      height="auto"
      timeZone="UTC"
      now={`${today}T00:00:00Z`}
      colorScheme={resolvedTheme === "light" ? "light" : "dark"}
      events={events}
      dayMaxEvents={4}
      fixedWeekCount={false}
      displayEventTime={false}
      navLinks={false}
      eventOrder="start,-duration,title"
      eventClass={(info) => {
        const entry = info.event.extendedProps.entry as HrCalendarEntry | undefined;
        return cn(
          "cursor-pointer outline-ring/50 focus-visible:outline-3",
          // Undecided: an outline, not a block.
          entry?.kind === "leave" &&
            entry.status === "pending" &&
            "border-dashed! border-(--fc-event-color)! bg-transparent!",
          // Leave an agency event has run into.
          entry && hasConflict(entry) && "ring-2 ring-destructive/70",
        );
      }}
      datesSet={(info: DatesSetInfo) =>
        onRangeChange({
          from: info.startStr.slice(0, 10),
          to: fromExclusiveEnd(info.endStr),
        })
      }
      eventClick={(info: EventClickInfo) => {
        info.jsEvent.preventDefault();
        const entry = info.event.extendedProps.entry as HrCalendarEntry | undefined;
        if (entry) onEntryClick(entry);
      }}
      addButton={
        onAdd ? { text: "Add event", hint: "Add an event", click: () => onAdd() } : undefined
      }
      selectable={Boolean(onAdd)}
      select={
        onAdd
          ? (info: DateSelectInfo) =>
              onAdd({
                from: info.startStr.slice(0, 10),
                to: fromExclusiveEnd(info.endStr),
              })
          : undefined
      }
    />
  );
}
