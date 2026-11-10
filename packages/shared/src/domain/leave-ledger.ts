/**
 * The leave ledger's vocabulary (PAC-174 owns the collection, PAC-165 adds
 * the request-driven writers).
 *
 * `leaveLedger` is append-only: one row per movement of hours for a person
 * in a policy, and the **balance is never stored** — it is the sum of a
 * person's rows in that policy, derived on every read (PAC-148 §7).
 *
 * | Kind | Sign | Written by |
 * |---|---|---|
 * | `allocation` | + | PAC-174: the starting balance at activation / enrolment, the monthly twelfth, the yearly grant |
 * | `carryover` | + | PAC-174: what survives a reset (the period reopens) |
 * | `expiration` | − | PAC-174: the balance closed out at a reset; what the carryover cap does not keep is the net loss |
 * | `removed_from_policy` | 0 | PAC-174: the person left the policy; re-adding resumes the rows above it |
 * | `used` | − | PAC-165: an approved request, dated on the leave days |
 * | `reversal` | + | PAC-165: an approved request cancelled (`reversesId` links the `used` row) |
 * | `manual_adjustment` | ± | PAC-165: an admin's correction, reason required |
 */
export const LEAVE_LEDGER_KINDS = [
  'allocation',
  'carryover',
  'expiration',
  'removed_from_policy',
  'used',
  'reversal',
  'manual_adjustment',
] as const;
export type LeaveLedgerKind = (typeof LEAVE_LEDGER_KINDS)[number];

/** Where a row came from; `id` is the policy, request or adjustment behind it. */
export const LEAVE_LEDGER_SOURCE_KINDS = [
  'activation',
  'enrollment',
  'accrual',
  'reset',
  'request',
  'admin',
] as const;
export type LeaveLedgerSourceKind = (typeof LEAVE_LEDGER_SOURCE_KINDS)[number];

/** Why an accrual was clipped or skipped — the `reason` on job-written rows. */
export const LEAVE_LEDGER_REASONS = ['max_balance', 'carryover_cap'] as const;
export type LeaveLedgerReason = (typeof LEAVE_LEDGER_REASONS)[number];
