import {
  Award,
  Ban,
  Cake,
  CalendarHeart,
  DoorClosed,
  PartyPopper,
  Plane,
  type LucideIcon,
} from "lucide-react";
import {
  toExclusiveEnd,
  type AgencyEventEffect,
  type HrCalendarEntry,
  type HrCalendarEventEntry,
} from "@sfa/shared";
import { formatClock } from "@/features/hr/policies/policy-display";

/**
 * How the HR calendar (PAC-169) draws its entries: which layer each belongs
 * to, the colour token behind it and the words on it.
 *
 * Colour is always a `theme.css` token handed to FullCalendar as the event's
 * `color`; the theme (`ui/event-calendar-views.tsx`) tints the block from it
 * with `color-mix` against `--background`, so light and dark follow without
 * a second set of values. Meaning never rests on colour alone: every layer
 * has an icon in the legend and its own wording on the entry.
 */

export const CALENDAR_LAYERS = [
  "holidays",
  "events",
  "timeOff",
  "birthdays",
  "anniversaries",
] as const;
export type CalendarLayer = (typeof CALENDAR_LAYERS)[number];

export interface LayerMeta {
  label: string;
  icon: LucideIcon;
  /** A CSS colour: a token reference. */
  color: string;
}

export const LAYER_META: Record<CalendarLayer, LayerMeta> = {
  holidays: { label: "Holidays", icon: CalendarHeart, color: "var(--success)" },
  events: { label: "Events", icon: PartyPopper, color: "var(--primary)" },
  timeOff: { label: "Time off", icon: Plane, color: "var(--chart-4)" },
  birthdays: { label: "Birthdays", icon: Cake, color: "var(--chart-5)" },
  anniversaries: { label: "Work anniversaries", icon: Award, color: "var(--chart-5)" },
};

export function layerOf(entry: HrCalendarEntry): CalendarLayer {
  switch (entry.kind) {
    case "holiday":
      return "holidays";
    case "event":
      return "events";
    case "leave":
      return "timeOff";
    case "birthday":
      return "birthdays";
    case "anniversary":
      return "anniversaries";
  }
}

export const EVENT_EFFECT_META: Record<
  AgencyEventEffect,
  { label: string; hint: string; icon: LucideIcon; color: string }
> = {
  none: {
    label: "On the calendar only",
    hint: "Shown on the calendar. Time off is not affected.",
    icon: PartyPopper,
    color: "var(--primary)",
  },
  blackout: {
    label: "No time off",
    hint: "Nobody it is for can ask for time off on these days.",
    icon: Ban,
    // The amber token: a restriction, not an error.
    color: "var(--destructive)",
  },
  day_off: {
    label: "Day off",
    hint: "The office is closed for the people it is for. Time off costs nothing on these days.",
    icon: DoorClosed,
    color: "var(--success)",
  },
};

/** "6:00 PM – 9:00 PM", "From 6:00 PM", or nothing for an all-day event. */
export function eventTimeLabel(
  event: Pick<HrCalendarEventEntry, "startTime" | "endTime">,
): string | null {
  if (!event.startTime) return null;
  return event.endTime
    ? `${formatClock(event.startTime)} – ${formatClock(event.endTime)}`
    : `From ${formatClock(event.startTime)}`;
}

/** The colour token of one entry. */
export function entryColor(entry: HrCalendarEntry): string {
  if (entry.kind === "event") return EVENT_EFFECT_META[entry.effect].color;
  return LAYER_META[layerOf(entry)].color;
}

/** The words on an entry in the grid. */
export function entryTitle(entry: HrCalendarEntry): string {
  switch (entry.kind) {
    case "holiday":
      return entry.name;
    case "event": {
      const time = eventTimeLabel(entry);
      const effect = entry.effect === "none" ? null : EVENT_EFFECT_META[entry.effect].label;
      return [time, entry.name, effect].filter(Boolean).join(" · ");
    }
    case "leave": {
      const who = entry.mine ? "You" : entry.person.name;
      if (entry.status === "pending") return `${who} · time off requested`;
      return entry.mine ? "You are out" : `${who} is out`;
    }
    case "birthday":
      return `${entry.person.name}’s birthday`;
    case "anniversary":
      return `${entry.person.name} · ${entry.years} ${entry.years === 1 ? "year" : "years"}`;
  }
}

/** A leave entry whose charged days run into an agency event. */
export function hasConflict(entry: HrCalendarEntry): boolean {
  return entry.kind === "leave" && (entry.detail?.conflicts.length ?? 0) > 0;
}

/**
 * An entry as FullCalendar takes it. Every entry is all-day, and
 * FullCalendar's all-day `end` is exclusive — `toExclusiveEnd` (shared, with
 * a spec) is the one place that is allowed to matter.
 */
export function toCalendarEvent(entry: HrCalendarEntry) {
  return {
    id: entry.id,
    title: entryTitle(entry),
    start: entry.firstDay,
    end: toExclusiveEnd(entry.lastDay),
    allDay: true,
    color: entryColor(entry),
    extendedProps: { entry },
  };
}
