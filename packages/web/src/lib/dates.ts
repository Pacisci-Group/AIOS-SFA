/**
 * Today's calendar date **in the viewer's time zone**, as `YYYY-MM-DD` — the
 * value an `<input type="date">` holds.
 *
 * ⚠ Not `new Date().toISOString().slice(0, 10)`, which several schemas use as a
 * "not in the future" bound. That is the date in **UTC**: from 8pm EDT onwards
 * it is already tomorrow, so a sold date defaulted that way would book an
 * evening sale on the wrong day — and the Sold scorecard buckets on exactly
 * that day.
 */
export function localTodayYmd(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Today on the **agency's** calendar, as `YYYY-MM-DD` (PAC-159).
 *
 * The default and the `max` of every business-date input — sold date, quote
 * date, lead date. The API rejects a date after today in `Agency.timezone`,
 * so the input has to agree with that calendar, not the viewer's: a producer
 * travelling east of the agency would otherwise be offered a day the API
 * refuses, and one travelling west be denied the agency's actual today.
 *
 * `timeZone` comes off the stored `AuthUser`; a blob written before the field
 * existed has none, and the browser's day is the best available fallback
 * until the next `/auth/me` refresh.
 */
export function agencyTodayYmd(
  timeZone: string | undefined,
  now: Date = new Date(),
): string {
  if (!timeZone) return localTodayYmd(now);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return localTodayYmd(now);
  }
}
