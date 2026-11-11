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
  | 'payouts';

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
  /**
   * The agency owner assigned a Dash Reconciliation row to a Producer or CSR
   * (PAC-173). Recipients: the assignee — never the person who assigned it.
   * `data`: `{ rowId, runId, policyNumber, customerName, tabLabel,
   * assignerName }`. No email: nothing producer-facing is emailed from this
   * feature (owner, 26 Oct 2026); in-app and push are the hand-off.
   */
  'reconciliation.row_assigned': {
    category: 'service',
    defaultChannels: { email: false, push: true },
  },
  /**
   * The 1st-of-month job drafted an agency's pay statements for the month
   * before (PAC-178). Recipients: the agency's active owners and branch
   * managers — the people who review and send them. A manual Generate does
   * not send it: whoever pressed the button is looking at the result.
   * `data`: `{ runId, month, monthLabel, statements }` (`month` is
   * `YYYY-MM`). Dedupe: `payout-run:<runId>:ready`. Email is on: the review
   * is month-end work for someone who may not open the app that morning.
   */
  'payouts.run_ready': {
    category: 'payouts',
    defaultChannels: { email: true, push: true },
  },
  /**
   * A reviewer sent someone their commission statement (PAC-181) — one
   * statement, or each of a month's drafts through Send all. Recipients: the
   * statement's employee. `data`: `{ statementId, month, monthLabel, version,
   * senderName }`. Dedupe: `pay-statement:<id>:sent:v<version>`, so sending
   * the same version twice tells nobody twice while a reissued version (after
   * a reopen or a dispute) is a new notification. **No amounts** on purpose:
   * the email may land in a shared inbox, and the link opens the statement
   * behind sign-in. Email is on: the statement asks for the employee's review.
   */
  'payouts.statement_sent': {
    category: 'payouts',
    defaultChannels: { email: true, push: true },
  },
  /**
   * An employee disputed their commission statement (PAC-182). Recipients:
   * the branch managers of the employee's branch, else the agency owners —
   * never the employee. `data`: `{ statementId, month, monthLabel, version,
   * employeeName }`. Dedupe: `pay-statement:<id>:rejected:v<version>` — one
   * dispute per version, since a disputed version can only be sent again as
   * the next one. **No notes and no amounts**: the notes may quote pay, and
   * the link opens them behind sign-in. Email is on: someone has to correct
   * the statement and send it again.
   */
  'payouts.statement_rejected': {
    category: 'payouts',
    defaultChannels: { email: true, push: true },
  },
  /**
   * An employee accepted their commission statement (PAC-182). Recipients:
   * whoever sent the version, and the same managers as a dispute — never the
   * employee. `data`: `{ statementId, month, monthLabel, version,
   * employeeName }`. Dedupe: `pay-statement:<id>:accepted:v<version>`. Push
   * only: nothing is asked of anyone.
   */
  'payouts.statement_accepted': {
    category: 'payouts',
    defaultChannels: { email: false, push: true },
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
