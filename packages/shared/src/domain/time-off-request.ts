import { roundHours } from './time-off-accrual';
import type { TimeOffTypeKey } from './time-off-policy';
import type { ScheduledDay, ScheduledDayReason } from './work-week';

/**
 * Time off requests (PAC-165): the lifecycle vocabulary, the per-date hours
 * maths and the balance lines the screens show.
 *
 * Pure and calendar-only, like the accrual module beside it: every date is a
 * `YYYY-MM-DD` on the agency's calendar, decided by the caller. The API turns
 * these answers into documents and ledger rows; the web renders them. Both
 * read the *same* functions for "what may happen to this request next", so
 * the buttons a person sees and the guards the API enforces cannot disagree.
 *
 * ⚠ `time-off.ts` holds a different, older vocabulary — the SmartSuite labels
 * (`TimeOffStatus = 'Submitted' | …`, `TimeOffRequestType`) on *imported*
 * rows. Those rows are read-only history and never enter this lifecycle.
 */

/** A `YYYY-MM-DD` calendar date. */
type IsoDate = string;

// ── Lifecycle ────────────────────────────────────────────────────────────

export const TIME_OFF_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'changes_requested',
  'approved',
  'declined',
  'cancelled',
] as const;
export type TimeOffRequestStatus = (typeof TIME_OFF_REQUEST_STATUSES)[number];

export const TIME_OFF_REQUEST_STATUS_LABELS: Record<TimeOffRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Pending',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

/** The statuses that hold hours against a balance and block the same dates. */
export const LIVE_TIME_OFF_REQUEST_STATUSES = [
  'submitted',
  'changes_requested',
  'approved',
] as const satisfies readonly TimeOffRequestStatus[];

/** Waiting on a person: what blocks archiving the policy. */
export const UNDECIDED_TIME_OFF_REQUEST_STATUSES = [
  'submitted',
  'changes_requested',
] as const satisfies readonly TimeOffRequestStatus[];

/**
 * How a request came to exist. `legacy` rows were imported from SmartSuite:
 * they carry no status and no policy, and nothing may act on them.
 */
export const TIME_OFF_REQUEST_SOURCES = ['self', 'recorded', 'legacy'] as const;
export type TimeOffRequestSource = (typeof TIME_OFF_REQUEST_SOURCES)[number];

export const TIME_OFF_DAY_MODES = ['full', 'partial'] as const;
export type TimeOffDayMode = (typeof TIME_OFF_DAY_MODES)[number];

export const TIME_OFF_DAY_MODE_LABELS: Record<TimeOffDayMode, string> = {
  full: 'Full days',
  partial: 'Partial days',
};

/** What a `timeline[]` entry records. */
export const TIME_OFF_TIMELINE_ACTIONS = [
  'created',
  'submitted',
  'resubmitted',
  'auto_approved',
  'approved',
  'changes_requested',
  'declined',
  'cancelled',
  'recorded',
  'imported',
] as const;
export type TimeOffTimelineAction = (typeof TIME_OFF_TIMELINE_ACTIONS)[number];

/** What a person may do to a request. */
export const TIME_OFF_REQUEST_ACTIONS = [
  'edit',
  'submit',
  'discard',
  'cancel',
  'approve',
  'request_changes',
  'decline',
] as const;
export type TimeOffRequestAction = (typeof TIME_OFF_REQUEST_ACTIONS)[number];

const TRANSITIONS: Partial<
  Record<
    TimeOffRequestAction,
    { from: readonly TimeOffRequestStatus[]; to: TimeOffRequestStatus }
  >
> = {
  submit: { from: ['draft', 'changes_requested'], to: 'submitted' },
  approve: { from: ['submitted'], to: 'approved' },
  request_changes: { from: ['submitted'], to: 'changes_requested' },
  decline: { from: ['submitted'], to: 'declined' },
  cancel: { from: ['submitted', 'changes_requested', 'approved'], to: 'cancelled' },
};

/**
 * The status an action leads to from `from`, or `null` when the lifecycle
 * does not allow it. Declined and Cancelled are terminal; `edit` and
 * `discard` change no status and are not transitions.
 */
export function canTransition(
  from: TimeOffRequestStatus,
  action: TimeOffRequestAction,
): TimeOffRequestStatus | null {
  const rule = TRANSITIONS[action];
  return rule && rule.from.includes(from) ? rule.to : null;
}

export interface TimeOffRequestViewer {
  /** The request is the viewer's own time off. */
  isEmployee: boolean;
  /**
   * The viewer holds `hr:write` and their data scope covers the request.
   * Never true together with `isEmployee` in effect: nobody decides their own.
   */
  canReview: boolean;
}

/**
 * The actions open to `viewer` on a request today. The API returns this list
 * on the request and checks the same function before acting.
 *
 * - The employee edits, sends and discards a Draft; edits, resends and
 *   cancels a Changes Requested; withdraws a Submitted; and cancels Approved
 *   leave **until the day before it starts** (decided 2026-11-05).
 * - A reviewer decides a Submitted request and may cancel Approved leave at
 *   any time — the policy's closed-period rule is the service's to add.
 * - An imported row allows nothing.
 */
export function requestActions(
  request: {
    source: TimeOffRequestSource;
    status: TimeOffRequestStatus | null;
    firstDay: IsoDate | null;
  },
  viewer: TimeOffRequestViewer,
  today: IsoDate,
): TimeOffRequestAction[] {
  if (request.source === 'legacy' || !request.status) return [];
  if (viewer.isEmployee) {
    switch (request.status) {
      case 'draft':
        return ['edit', 'submit', 'discard'];
      case 'changes_requested':
        return ['edit', 'submit', 'cancel'];
      case 'submitted':
        return ['cancel'];
      case 'approved':
        return request.firstDay && today < request.firstDay ? ['cancel'] : [];
      default:
        return [];
    }
  }
  if (!viewer.canReview) return [];
  if (request.status === 'submitted') return ['approve', 'request_changes', 'decline'];
  if (request.status === 'approved') return ['cancel'];
  return [];
}

// ── List groups ──────────────────────────────────────────────────────────

/**
 * How the lists file a request. *Taken* is not a status: it is Approved leave
 * whose last day has passed, derived from the dates on every read.
 */
export const TIME_OFF_REQUEST_GROUPS = [
  'changes_requested',
  'draft',
  'pending',
  'approved',
  'taken',
  'declined',
  'cancelled',
  'imported',
] as const;
export type TimeOffRequestGroup = (typeof TIME_OFF_REQUEST_GROUPS)[number];

/** The employee's own list, in the order it is shown. */
export const MY_TIME_OFF_REQUEST_GROUPS = TIME_OFF_REQUEST_GROUPS;

/** The team list never shows somebody's Draft. */
export const TEAM_TIME_OFF_REQUEST_GROUPS = [
  'pending',
  'changes_requested',
  'approved',
  'taken',
  'declined',
  'cancelled',
  'imported',
] as const satisfies readonly TimeOffRequestGroup[];
export type TeamTimeOffRequestGroup = (typeof TEAM_TIME_OFF_REQUEST_GROUPS)[number];

export const TIME_OFF_REQUEST_GROUP_LABELS: Record<TimeOffRequestGroup, string> = {
  changes_requested: 'Changes requested',
  draft: 'Drafts',
  pending: 'Pending',
  approved: 'Approved',
  taken: 'Taken',
  declined: 'Declined',
  cancelled: 'Cancelled',
  imported: 'Imported',
};

export function requestGroup(
  request: {
    source: TimeOffRequestSource;
    status: TimeOffRequestStatus | null;
    lastDay: IsoDate | null;
  },
  today: IsoDate,
): TimeOffRequestGroup {
  if (request.source === 'legacy' || !request.status) return 'imported';
  switch (request.status) {
    case 'draft':
      return 'draft';
    case 'submitted':
      return 'pending';
    case 'changes_requested':
      return 'changes_requested';
    case 'approved':
      return request.lastDay && request.lastDay < today ? 'taken' : 'approved';
    case 'declined':
      return 'declined';
    case 'cancelled':
      return 'cancelled';
  }
}

// ── Hours per date ───────────────────────────────────────────────────────

/** Hours are entered in quarter hours. */
export const TIME_OFF_HOURS_STEP = 0.25;
/** A request covers at most this many calendar days, first to last. */
export const TIME_OFF_REQUEST_MAX_SPAN_DAYS = 366;
/** …and ends at most this many days after today. */
export const TIME_OFF_REQUEST_MAX_AHEAD_DAYS = 730;
export const TIME_OFF_NOTE_MAX_LENGTH = 1000;
export const BALANCE_ADJUSTMENT_REASON_MAX_LENGTH = 500;

/**
 * One date of a request, frozen when it is sent. Every date from the first
 * day to the last has a row, so a weekend or a holiday inside the range is
 * stored — at zero hours, with the reason it is not a working day.
 */
export interface TimeOffRequestDay {
  date: IsoDate;
  /** Hours of leave on the date; never above `scheduledHours`. */
  hours: number;
  /** What the person's work week and holiday calendar schedule for the date. */
  scheduledHours: number;
  reason: ScheduledDayReason;
}

/**
 * The per-date hours of a request, from the person's scheduled days.
 *
 * **Full days** takes each date's scheduled hours — not a flat eight: a
 * person on a 7.5-hour day is off for 7.5, and a holiday costs nothing.
 * **Partial days** takes the hours typed for each date, clamped to what the
 * date schedules; a date with nothing typed defaults to its scheduled hours,
 * which is also how the form opens.
 */
export function requestDays(
  scheduled: readonly ScheduledDay[],
  dayMode: TimeOffDayMode,
  hoursByDate: Readonly<Record<string, number>> = {},
): TimeOffRequestDay[] {
  return scheduled.map((day) => {
    const scheduledHours = roundHours(day.scheduledMinutes / 60);
    const typed = hoursByDate[day.date];
    const wanted =
      dayMode === 'partial' && typeof typed === 'number' && Number.isFinite(typed)
        ? typed
        : scheduledHours;
    return {
      date: day.date,
      hours: roundHours(Math.min(Math.max(wanted, 0), scheduledHours)),
      scheduledHours,
      reason: day.reason,
    };
  });
}

export function totalRequestHours(days: readonly Pick<TimeOffRequestDay, 'hours'>[]): number {
  return roundHours(days.reduce((sum, day) => sum + day.hours, 0));
}

/** The dates a request actually takes hours on. */
export function datesWithHours(
  days: readonly Pick<TimeOffRequestDay, 'date' | 'hours'>[],
): IsoDate[] {
  return days.filter((day) => day.hours > 0).map((day) => day.date);
}

/**
 * The dates two requests both take hours on. A weekend that merely sits
 * inside both ranges is not a clash; a working day in both is (decided
 * 2026-11-05: a hard block, whatever the hours).
 */
export function overlappingDates(
  a: readonly Pick<TimeOffRequestDay, 'date' | 'hours'>[],
  b: readonly Pick<TimeOffRequestDay, 'date' | 'hours'>[],
): IsoDate[] {
  const taken = new Set(datesWithHours(b));
  return datesWithHours(a).filter((date) => taken.has(date));
}

/** Hours by date, positive, zero-hour dates left out — the projection's input. */
export function hoursByDate(
  days: readonly Pick<TimeOffRequestDay, 'date' | 'hours'>[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of days) {
    if (day.hours > 0) out[day.date] = roundHours((out[day.date] ?? 0) + day.hours);
  }
  return out;
}

// ── Balance lines ────────────────────────────────────────────────────────

/**
 * Gusto's four lines (decided 2026-11-05), shown the same way to the
 * employee and the reviewer:
 *
 * - **Current balance** — the ledger as of today.
 * - **Other requested hours** — approved leave that has not happened yet,
 *   plus the person's other requests still waiting for a decision.
 * - **This request** — the hours of the request being made or reviewed.
 * - **Remaining available balance** — the first minus the other two.
 */
export interface TimeOffBalanceLines {
  currentBalance: number;
  otherRequestedHours: number;
  thisRequestHours: number;
  remainingHours: number;
}

export function balanceLines(input: {
  currentBalance: number;
  otherRequestedHours: number;
  thisRequestHours: number;
}): TimeOffBalanceLines {
  return {
    currentBalance: roundHours(input.currentBalance),
    otherRequestedHours: roundHours(input.otherRequestedHours),
    thisRequestHours: roundHours(input.thisRequestHours),
    remainingHours: roundHours(
      input.currentBalance - input.otherRequestedHours - input.thisRequestHours,
    ),
  };
}

/** The card's **Available hours**: Current balance − Other requested hours. */
export function availableHours(currentBalance: number, otherRequestedHours: number): number {
  return roundHours(currentBalance - otherRequestedHours);
}

// ── Checks ───────────────────────────────────────────────────────────────

/**
 * Why a request cannot be sent, or — on a recorded entry — what it went
 * over. The API puts the code on a refusal's body and on a preview's
 * `blockers` / `warnings`; clients switch on the code, never the message.
 */
export const TIME_OFF_CHECK_CODES = [
  'not_enrolled',
  'policy_unavailable',
  'waiting_period',
  'past_date',
  'no_scheduled_hours',
  'span_too_long',
  'overlap',
  'usage_cap',
  'negative_balance',
  'old_period',
  'already_decided',
  'own_request',
  'imported',
] as const;
export type TimeOffCheckCode = (typeof TIME_OFF_CHECK_CODES)[number];

/** The checks a recorded entry only warns about (decided 2026-11-05). */
export const RECORD_WARNING_CODES = [
  'waiting_period',
  'usage_cap',
  'negative_balance',
] as const satisfies readonly TimeOffCheckCode[];

export interface TimeOffCheck {
  code: TimeOffCheckCode;
  message: string;
}

// ── Views ────────────────────────────────────────────────────────────────

export interface TimeOffPersonRef {
  id: string;
  name: string;
}

export interface TimeOffPolicyRef {
  id: string;
  name: string;
  timeOffType: TimeOffTypeKey;
  /** No balance, no lines. */
  unlimited: boolean;
}

/** The projected balance, shown when an accrual or a reset falls in the window. */
export interface TimeOffProjectionView {
  lowestBalance: number;
  lowestOn: IsoDate | null;
  crossesAccrual: boolean;
}

/** The SmartSuite labels of an imported row — display only. */
export interface TimeOffLegacyLabels {
  status: string | null;
  type: string | null;
  requestType: string | null;
}

/** A request in a list. */
export interface TimeOffRequestRow {
  id: string;
  /** `TOR-2026-007`; null on an imported row. */
  reference: string | null;
  source: TimeOffRequestSource;
  status: TimeOffRequestStatus | null;
  group: TimeOffRequestGroup;
  employee: TimeOffPersonRef | null;
  /** Who recorded it, when it was recorded for the employee. */
  recordedBy: TimeOffPersonRef | null;
  policy: TimeOffPolicyRef | null;
  firstDay: IsoDate | null;
  lastDay: IsoDate | null;
  dayMode: TimeOffDayMode | null;
  totalHours: number;
  autoApproved: boolean;
  /** ISO-8601. */
  submittedAt: string | null;
  createdAt: string | null;
  legacy: TimeOffLegacyLabels | null;
}

export interface TimeOffTimelineEntryView {
  /** ISO-8601. */
  at: string;
  /** Null = the system (auto-approval, the import). */
  actor: TimeOffPersonRef | null;
  action: TimeOffTimelineAction;
  fromStatus: TimeOffRequestStatus | null;
  toStatus: TimeOffRequestStatus | null;
  note: string | null;
  /** The limits a recorded entry went over. */
  warnings: TimeOffCheckCode[];
}

/** Somebody else in the branch off on the same dates — information only. */
export interface TimeOffOtherOffView {
  employee: TimeOffPersonRef;
  firstDay: IsoDate;
  lastDay: IsoDate;
  status: TimeOffRequestStatus;
}

/** `GET /time-off/requests/:id`. */
export interface TimeOffRequestView extends TimeOffRequestRow {
  days: TimeOffRequestDay[];
  note: string | null;
  timeline: TimeOffTimelineEntryView[];
  /** Present while the request is undecided, on a policy with a balance. */
  balance: TimeOffBalanceLines | null;
  projection: TimeOffProjectionView | null;
  actions: TimeOffRequestAction[];
  /** Present for a reviewer only. */
  othersOff?: TimeOffOtherOffView[];
}

/** `POST /time-off/requests/preview` and `…/records/preview`. Writes nothing. */
export interface TimeOffPreview {
  days: TimeOffRequestDay[];
  totalHours: number;
  balance: TimeOffBalanceLines | null;
  projection: TimeOffProjectionView | null;
  /** What stops the request being sent. */
  blockers: TimeOffCheck[];
  /** What a recorded entry goes over, and may still be saved with. */
  warnings: TimeOffCheck[];
}

export interface TimeOffSummaryPolicy extends TimeOffPolicyRef {
  /** All three null on an Unlimited policy. */
  currentBalance: number | null;
  otherRequestedHours: number | null;
  availableHours: number | null;
}

/** `GET /time-off/summary` — the employee's cards. */
export interface TimeOffSummary {
  policies: TimeOffSummaryPolicy[];
  /** How many other people can decide this person's requests. */
  reviewerCount: number;
}

export interface TimeOffRequestList {
  items: TimeOffRequestRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** A person time off can be recorded for, with the policies they are in. */
export interface RecordablePersonView {
  id: string;
  name: string;
  branchName: string | null;
  policies: TimeOffPolicyRef[];
}

// ── Inputs ───────────────────────────────────────────────────────────────

export interface TimeOffRequestInput {
  policyId: string;
  firstDay: IsoDate;
  lastDay: IsoDate;
  dayMode: TimeOffDayMode;
  /** Partial days only: hours typed per date. */
  hours?: Record<string, number>;
  note?: string | null;
}

/** `POST /time-off/requests`. `send: false` saves a Draft. */
export interface CreateTimeOffRequestInput extends TimeOffRequestInput {
  send: boolean;
}

/** `POST /time-off/requests/preview`. */
export interface PreviewTimeOffRequestInput extends TimeOffRequestInput {
  /** The request being edited, left out of "other requested hours". */
  requestId?: string;
}

/** `POST /time-off/records` — recorded for somebody else, Approved at once. */
export interface RecordTimeOffInput extends TimeOffRequestInput {
  employeeId: string;
}

/** Approve (optional note), request changes / decline / cancel approved leave (required). */
export interface TimeOffDecisionInput {
  note?: string | null;
}

/** `POST /hr/people/:userId/balance-adjustments`. */
export interface BalanceAdjustmentInput {
  policyId: string;
  /** Signed, non-zero, two decimals. */
  hours: number;
  reason: string;
}

export interface BalanceAdjustmentResult {
  balanceHours: number;
}
