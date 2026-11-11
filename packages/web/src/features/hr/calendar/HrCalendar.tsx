import { useMemo } from "react";
import type {
  DateClickInfo,
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
  /**
   * A phone: opens on the list, and the month grid becomes a day picker — a
   * mark per entry under the day number, and a tap opens that day's list.
   */
  compact: boolean;
  onRangeChange: (range: CalendarRange) => void;
  onEntryClick: (entry: HrCalendarEntry) => void;
  /** Compact only: a day was tapped on the month grid. */
  onDayPick?: (date: string) => void;
  /** Set for someone who manages events: the toolbar button and day selection. */
  onAdd?: (range?: CalendarRange) => void;
}

const VIEWS = ["dayGridMonth", "dayGridWeek", "listMonth"];
/** No week on a phone: seven columns of a day grid are unreadable there. */
const COMPACT_VIEWS = ["listMonth", "dayGridMonth"];

const BASE_EVENT_CLASS =
  "cursor-pointer outline-ring/50 focus-visible:outline-3";

/**
 * The one place FullCalendar is used (PAC-169) — the exception recorded in
 * `packages/web/CLAUDE.md`. Everything it is handed is plain data: entries
 * mapped by `calendar-display.ts`, colours as `theme.css` tokens.
 *
 * ## Whole days, no zone
 *
 * Every entry is a `YYYY-MM-DD` range on the agency's calendar, so the
 * calendar runs in `timeZone="UTC"` and only ever reads the **string** forms
 * of the dates it reports (`startStr`, `endStr`, `dateStr`). A `Date` object
 * here would be the reader's local midnight, which is the wrong day for
 * half the world. "Today" is handed in for the same reason: it is the
 * agency's today, not the browser's.
 *
 * ## The week is a day grid
 *
 * `dayGridWeek`, not a time grid: nothing on this calendar has a duration in
 * hours — an event's time is shown in its title — so an hour grid would be
 * an empty column of lines.
 *
 * ## A phone gets a day picker
 *
 * A month grid shrunk to 375 px has room for a dozen letters per day. So
 * on a phone the month's entries are drawn as marks — the same colour bars,
 * no words — and a tap on a day hands that day to `onDayPick`, whose sheet
 * lists it. The list view, which reads well at any width, is the first one.
 */
export function HrCalendar({
  entries,
  today,
  compact,
  onRangeChange,
  onEntryClick,
  onDayPick,
  onAdd,
}: HrCalendarProps) {
  const { resolvedTheme } = useTheme();
  // A new array every render would make FullCalendar re-read its events and
  // fire `datesSet` again: keep the identity tied to the entries.
  const events = useMemo(() => entries.map(toCalendarEvent), [entries]);

  const entryOf = (info: {
    event: { extendedProps: Record<string, unknown> };
  }) => info.event.extendedProps.entry as HrCalendarEntry | undefined;

  return (
    <EventCalendar
      className="rounded-xl"
      availableViews={compact ? COMPACT_VIEWS : VIEWS}
      // The list scrolls with the page; the grids fit the screen and scroll inside.
      height={compact ? "auto" : "max(34rem, calc(100dvh - 17rem))"}
      timeZone="UTC"
      now={`${today}T00:00:00Z`}
      colorScheme={resolvedTheme === "light" ? "light" : "dark"}
      events={events}
      dayMaxEvents={compact ? 3 : 4}
      fixedWeekCount={false}
      displayEventTime={false}
      navLinks={false}
      eventOrder="start,-duration,title"
      // "Wed, Nov 11" on one line: the two-line date the theme sets by
      // default wrapped under its own "today" pill on a phone.
      listDayFormat={{ weekday: "short", month: "short", day: "numeric" }}
      listDayAltFormat={false}
      views={
        compact
          ? {
              dayGridMonth: {
                // Marks, not words: a coloured bar the height of a line.
                eventContent: () => (
                  <span aria-hidden className="block h-1.5 w-full" />
                ),
                moreLinkContent: (info: { num: number }) => `+${info.num}`,
                moreLinkClick: (info: { date: Date }) => {
                  onDayPick?.(info.date.toISOString().slice(0, 10));
                  return "";
                },
              },
            }
          : undefined
      }
      eventClass={(info) => {
        const entry = entryOf(info);
        return cn(
          BASE_EVENT_CLASS,
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
        const entry = entryOf(info);
        if (!entry) return;
        // On a phone's month grid a bar says nothing: open the day instead.
        if (compact && info.view.type === "dayGridMonth" && onDayPick) {
          onDayPick(entry.firstDay);
          return;
        }
        onEntryClick(entry);
      }}
      dateClick={
        compact && onDayPick
          ? (info: DateClickInfo) => onDayPick(info.dateStr.slice(0, 10))
          : undefined
      }
      addButton={
        onAdd
          ? { text: "Add event", hint: "Add an event", click: () => onAdd() }
          : undefined
      }
      // Drag-selecting days prefills the form; on a phone a tap is the day picker instead.
      selectable={Boolean(onAdd) && !compact}
      select={
        onAdd && !compact
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
