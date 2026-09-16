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
