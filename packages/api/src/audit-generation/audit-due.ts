/**
 * The audit-item deadline rule (PAC-65), extracted so it has one definition.
 *
 * Split out of `AuditGenerationService` because the SmartSuite migration needs
 * the same rule and must not import a request-path service to get it — the
 * precedent is `deriveDealType`, which moved into `common/domain/deal-derive`
 * for exactly this reason.
 */

/**
 * How long the service team is given on a generated audit item.
 *
 * ⚠ Soft. Nothing enforces it, and nothing should be built that does: no cron,
 * no auto-fail, no escalation, no status that flips itself at day 7. It exists
 * so the team can see a date on the board and pull an overdue list. An item past
 * its `dueAt` is still `in_progress` / failed until a human resolves it.
 */
export const AUDIT_ITEM_DUE_DAYS = 7;

/**
 * `date + n` days, as a plain `Date`.
 *
 * Wall-clock arithmetic, deliberately not `performance.range`'s calendar-part
 * `addDays`. That one walks `{ year, month, day }` in the agency time zone — the
 * right tool for scorecard buckets, the wrong one for a deadline that is only
 * ever compared against `new Date()`.
 */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** The deadline for an audit item raised at `raisedAt`. */
export function auditItemDueAt(raisedAt: Date): Date {
  return addDays(raisedAt, AUDIT_ITEM_DUE_DAYS);
}
