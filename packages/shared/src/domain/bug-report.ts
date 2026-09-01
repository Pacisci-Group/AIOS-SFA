/**
 * In-app bug reports — the floating "Report a bug" widget and the Super Admin
 * queue that reads it.
 *
 * ## Why this is a platform record, not a tenant one
 *
 * Every other collection in this codebase extends `TenantRecord` and is read
 * back inside one agency. This one is the opposite on both counts: a report is
 * *about the product*, it is triaged by whoever operates the platform, and the
 * reporter may be a platform admin — who has **no `agencyId` at all**. So
 * `agencyId`/`branchId` are recorded as context (which tenant was this person
 * looking at when it broke?) and are nullable, and the read path lives behind
 * `platform:bugs:read` rather than a module permission.
 *
 * That nullability is the whole reason it does not extend `TenantRecord`, whose
 * `agencyId` and `branchId` are both `required: true`.
 */

/**
 * How badly the reporter is blocked.
 *
 * Their word, never ours — this is the reporter's own read of the impact and
 * the triage status below is what the platform decides about it. Deliberately
 * four coarse steps: a ten-point scale from people who are mid-task produces
 * noise, not signal.
 */
export type BugSeverity = 'low' | 'normal' | 'high' | 'blocking';

export const BUG_SEVERITIES: readonly BugSeverity[] = [
  'low',
  'normal',
  'high',
  'blocking',
] as const;

export const BUG_SEVERITY_LABELS: Record<BugSeverity, string> = {
  low: 'Minor annoyance',
  normal: 'Something is wrong',
  high: 'Blocking part of my work',
  blocking: "I can't work at all",
};

/**
 * Where a report has got to in triage.
 *
 * `new` → `triaged` → `in_progress` → `resolved`, with `wont_fix` reachable
 * from anywhere. Not a state machine in code: an operator can set any status
 * from any other, because a queue that argues with the person working it gets
 * worked around rather than used.
 */
export type BugReportStatus =
  | 'new'
  | 'triaged'
  | 'in_progress'
  | 'resolved'
  | 'wont_fix';

export const BUG_REPORT_STATUSES: readonly BugReportStatus[] = [
  'new',
  'triaged',
  'in_progress',
  'resolved',
  'wont_fix',
] as const;

export const BUG_REPORT_STATUS_LABELS: Record<BugReportStatus, string> = {
  new: 'New',
  triaged: 'Triaged',
  in_progress: 'In progress',
  resolved: 'Resolved',
  wont_fix: "Won't fix",
};

/** Statuses that need no further action — the queue's default filter hides them. */
export const OPEN_BUG_REPORT_STATUSES: readonly BugReportStatus[] = [
  'new',
  'triaged',
  'in_progress',
] as const;

/**
 * What the browser knew at the moment the report was filed.
 *
 * Collected automatically because a reporter mid-task will not type any of it,
 * and "which page were you on" is the first question triage asks. Nothing here
 * is trusted for authorization — it is all client-supplied and only ever
 * displayed.
 */
export interface BugReportContext {
  /** Full `location.href` at submit time, query string included. */
  url: string | null;
  /**
   * `location.pathname` — the concrete path, **not** the route pattern.
   *
   * `/leads/68f…c21`, never `/leads/:id`. The pattern would group reports by
   * screen far better, but `useMatches` is data-router-only and `packages/web`
   * runs React Router in declarative mode (`BrowserRouter` + `Routes`), so the
   * matched pattern is not reachable from a component. Stored separately from
   * {@link url} anyway because a path with no origin, query or hash is what
   * makes the queue's rows scannable.
   */
  route: string | null;
  userAgent: string | null;
  viewport: { width: number; height: number } | null;
  /** `light` or `dark` — a surprising number of bugs are theme-only. */
  theme: string | null;
}

/** One uploaded screenshot, as the API hands it back. */
export interface BugReportScreenshot {
  /**
   * Stable per-screenshot id (the Mongo subdocument `_id`).
   *
   * The storage key is deliberately **not** in this shape: it never crosses the
   * wire in either direction, matching quote documents and audit attachments.
   */
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /**
   * Short-lived presigned GET, signed `inline` so it renders in an `<img>`.
   *
   * Present only on the platform detail read, and only valid for
   * `screenshotUrlExpiresIn` seconds — see {@link BugReportDetail}.
   */
  url?: string;
}

/** A row in the Super Admin queue. No screenshots, no context — the list is a list. */
export interface BugReportListItem {
  id: string;
  status: BugReportStatus;
  severity: BugSeverity;
  /** First line of the description, capped. The full text is on the detail. */
  summary: string;
  reporterName: string | null;
  reporterEmail: string;
  agencyId: string | null;
  agencyName: string | null;
  screenshotCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One report in full, as the Super Admin detail view reads it. */
export interface BugReportDetail extends Omit<BugReportListItem, 'summary'> {
  description: string;
  context: BugReportContext;
  screenshots: BugReportScreenshot[];
  /**
   * Seconds the `url` on each screenshot stays valid.
   *
   * The client should keep its cache staleness below this so a remount
   * re-signs rather than rendering broken images.
   */
  screenshotUrlExpiresIn: number;
  internalNotes: string | null;
  statusUpdatedAt: string | null;
  statusUpdatedByName: string | null;
}

/** What the reporter gets back — a receipt, not the triage record. */
export interface BugReportReceipt {
  id: string;
  createdAt: string;
}

/** `GET /platform/bug-reports` — one page of the queue. */
export interface BugReportListResponse {
  items: BugReportListItem[];
  /** Total matching the filters, for the header count. */
  total: number;
  /** Per-status totals across the *unfiltered* set, for the filter chips. */
  statusCounts: Record<BugReportStatus, number>;
}

/**
 * Screenshot upload rules.
 *
 * Images only, and a tight-ish per-file cap: these are screen grabs, not
 * carrier documents. A retina full-screen PNG runs 2–5 MB, so 10 MB has real
 * headroom without inviting video.
 */
export const ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export type BugScreenshotContentType =
  (typeof ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES)[number];

export const MAX_BUG_SCREENSHOT_BYTES = 10 * 1024 * 1024;

/**
 * Screenshots per report.
 *
 * Five is enough for a before/after/console trio with room to spare, and it
 * bounds both the upload burst and the detail page.
 */
export const MAX_BUG_SCREENSHOTS = 5;

export const MIN_BUG_DESCRIPTION_LENGTH = 10;
export const MAX_BUG_DESCRIPTION_LENGTH = 5_000;
export const MAX_BUG_INTERNAL_NOTES_LENGTH = 5_000;

/**
 * The list row's `summary`, derived rather than stored.
 *
 * A separate title field would be one more thing to fill in while mid-bug, and
 * the first line of what someone types is already the summary they would have
 * written. Exported so the API and any client that renders a draft agree on it.
 */
export function bugReportSummary(description: string, max = 120): string {
  const firstLine = description.trim().split('\n')[0]?.trim() ?? '';
  const source = firstLine || description.trim();
  return source.length > max ? `${source.slice(0, max - 1).trimEnd()}…` : source;
}
