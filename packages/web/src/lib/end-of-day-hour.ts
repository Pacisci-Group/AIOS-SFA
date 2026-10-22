/**
 * The end-of-day hour picker's options and labels (PAC-149).
 *
 * `Agency.endOfDayHour` is a whole hour, 0–23, on the agency's own clock — the
 * hour everyone is set Away. Whole hours only because the API's sweep ticks
 * every thirty minutes; the API refuses anything else.
 *
 * Labelled in 12-hour form (`8:00 PM`) because every agency on the platform is
 * in the US. Formatted in UTC on purpose: the label names an hour on the
 * *agency's* clock, so the viewer's own zone must not shift it.
 */

const HOUR_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** `20` → `8:00 PM`, `0` → `12:00 AM`. */
export function endOfDayHourLabel(hour: number): string {
  return HOUR_FORMAT.format(Date.UTC(2000, 0, 1, hour));
}

/**
 * All 24 hours, midnight first. Values are strings because `SelectField`'s
 * are; the page converts back to a number when it saves.
 */
export const END_OF_DAY_HOUR_OPTIONS: readonly {
  value: string;
  label: string;
}[] = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: endOfDayHourLabel(hour),
}));
