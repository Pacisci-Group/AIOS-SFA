/**
 * The notification type catalog (PAC-154).
 *
 * Every notification the platform sends has a **type** declared here. The type
 * is the contract between the three places that care about one notification:
 * the producer (a feature service or worker function emitting
 * `notification/requested.v1`), the worker that renders and stores it, and the
 * clients that display it. Adding a type is one row here plus one renderer in
 * `render.ts`; the shared `render.spec.ts` fails until both exist.
 *
 * ## What a row carries
 *
 * `category` groups types for a future filter; `defaultChannels` says which
 * secondary channels a type uses **until per-user preferences exist** (ticket
 * decision 4 — preferences are deferred, and when they land they are additive
 * on top of these defaults). The in-app channel is not listed because it is
 * mandatory for every type (PAC-148 FR-H1).
 *
 * ## Why so few rows
 *
 * Only the types with a real producer are listed. PAC-127 inventories every
 * trigger with the owner and adds the rest *as each sender is wired*; a row
 * with a renderer nobody emits is guesswork about a payload nobody has agreed.
 */
export type NotificationCategory =
  | 'platform'
  | 'leads'
  | 'audits'
  | 'goals'
  | 'service'
  | 'campaigns'
  | 'attendance'
  | 'hr';

export interface NotificationChannelDefaults {
  /** The email channel through the existing worker pipeline. */
  email: boolean;
  /** Web push to the recipient's subscribed devices when no window is focused. */
  push: boolean;
}

export interface NotificationTypeDefinition {
  category: NotificationCategory;
  defaultChannels: NotificationChannelDefaults;
}

export const NOTIFICATION_TYPES = {
  /**
   * A bug report was filed (PAC-82 queue, PAC-127 "nothing is sent yet").
   * Recipients: every active platform admin other than the reporter.
   * `data`: `{ bugReportId, summary, severity, reporterName, agencyId }`.
   *
   * Email is on (PAC-154 PR3): a platform admin is rarely *in* the app when a
   * report lands, and the queue has no other way to reach them. It is also
   * the only producer wired today, so this is what exercises the channel.
   */
  'bug_report.filed': {
    category: 'platform',
    defaultChannels: { email: true, push: true },
  },

  /*
   * Time off requests (PAC-165). Every type below is emitted by
   * `TimeOffRequestsService` after the request's own write has committed and
   * links to the request (`/time-off/requests/<id>`). They share one `data`
   * shape: `{ requestId, reference, employeeName, actorName, policyName,
   * firstDay, lastDay, totalHours, note }` plus the flag named on the row.
   *
   * "Reviewers" are the `hr:write` holders whose data scope covers the
   * request, minus the employee and whoever acted. There is no fallback
   * audience: with no reviewer nothing is sent (decided 2026-11-05).
   */

  /** Sent or resent for review (`data.resubmitted`). To the reviewers. */
  'time_off.submitted': {
    category: 'hr',
    defaultChannels: { email: true, push: true },
  },
  /** A reviewer asked for changes; the note is theirs. To the employee. */
  'time_off.changes_requested': {
    category: 'hr',
    defaultChannels: { email: true, push: true },
  },
  /** Approved by a reviewer, or by the policy's rules (`data.automatic`). To the employee. */
  'time_off.approved': {
    category: 'hr',
    defaultChannels: { email: true, push: true },
  },
  /**
   * The policy approved a request on its own; nobody has anything to do. To
   * the reviewers, **in-app only** — an email saying "no action needed" is
   * the kind that teaches people to ignore the ones that need them.
   */
  'time_off.auto_approved_notice': {
    category: 'hr',
    defaultChannels: { email: false, push: false },
  },
  /** Declined, with the reviewer's reason. To the employee. */
  'time_off.declined': {
    category: 'hr',
    defaultChannels: { email: true, push: true },
  },
  /**
   * Approved leave was cancelled. `data.cancelledBy` says by whom: a
   * reviewer → to the employee; the employee → to the reviewers, who planned
   * around it. Withdrawing a request nobody had decided notifies no one.
   */
  'time_off.approval_cancelled': {
    category: 'hr',
    defaultChannels: { email: true, push: true },
  },
  /** Time off was recorded on the employee's behalf, already approved. To the employee. */
  'time_off.recorded': {
    category: 'hr',
    defaultChannels: { email: true, push: true },
  },
  /**
   * An HR admin adjusted a balance by hand. To the employee.
   * `data`: `{ policyName, hours (signed), reason, actorName }`.
   */
  'time_off.balance_adjusted': {
    category: 'hr',
    defaultChannels: { email: true, push: true },
  },
} as const satisfies Record<string, NotificationTypeDefinition>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/**
 * The catalog keys as a non-empty tuple, which is what `z.enum` wants on the
 * event contract. Derived, never typed by hand, so the enum and the catalog
 * cannot disagree.
 */
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as [
  NotificationType,
  ...NotificationType[],
];

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, value)
  );
}
