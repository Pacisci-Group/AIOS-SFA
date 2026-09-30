/**
 * Calendar-day ranges as the dashboards hold them in the URL.
 *
 * Shared by the Producer dashboard (PAC-9) and the Owner dashboard (PAC-135):
 * both have a strip of period chips with a custom picker on the end, both keep
 * the selection in the query string, and both must agree on what a usable
 * custom window is.
 */

/** A selected period. `from`/`to` are `YYYY-MM-DD`, inclusive, custom-only. */
export interface UrlRange<K extends string> {
  key: K | "custom";
  from?: string;
  to?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The one invariant of a range in a URL: **`custom` without a valid `from`/`to`
 * degrades to the default range** rather than issuing a request the API will
 * reject. That state is reachable by ordinary means — a shared link truncated at
 * `?range=custom`, or a reload mid-selection — so it has to resolve to something
 * sensible rather than a 400.
 */
export function parseUrlRange<K extends string>(
  values: { range: string; from: string; to: string },
  defaultKey: K,
): UrlRange<K> {
  const key = values.range as K | "custom";
  if (key !== "custom") return { key };

  const usable =
    ISO_DATE.test(values.from) &&
    ISO_DATE.test(values.to) &&
    values.from <= values.to;

  return usable
    ? { key: "custom", from: values.from, to: values.to }
    : { key: defaultKey };
}

/**
 * The three params to write for a range, together. `from`/`to` are cleared when
 * leaving custom, so switching to a preset and reloading cannot resurrect a
 * window the user moved off.
 */
export function toUrlRange<K extends string>(next: UrlRange<K>) {
  const custom = next.key === "custom";
  return {
    range: next.key as string,
    from: custom ? (next.from ?? "") : "",
    to: custom ? (next.to ?? "") : "",
  };
}

/** `2026-01-01` → `Jan 1`, dropping the year when it is the current one. */
export function formatRangeDate(iso: string): string {
  // Parsed as UTC noon: these are calendar dates with no time, and
  // `new Date('2026-01-01')` is UTC midnight, which renders as Dec 31 for any
  // viewer west of Greenwich.
  const date = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getUTCFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** `Jan 1 – Jan 31`, or a single date when the window is one day. */
export function formatRangeLabel(from: string, to: string): string {
  return from === to
    ? formatRangeDate(from)
    : `${formatRangeDate(from)} – ${formatRangeDate(to)}`;
}
