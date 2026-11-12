import type { RowOutcome } from './carry-forward';

/**
 * Whether an outcome has created something that outlives it: a deal booked
 * for the Dash line, or a policy (PAC-173 review). Its links are then the only
 * thing that says the deal or policy was this row's.
 */
export function hasBooked(outcome: RowOutcome | null | undefined): boolean {
  return !!(outcome?.dealId || outcome?.policyId);
}

/**
 * An outcome under way that has booked something — a sale at its next step,
 * or a sale held because its policy is numbered differently from Dash's.
 *
 * Nothing clears one: reassigning, unassigning or releasing the row keeps it
 * for whoever takes the row next, and a re-upload carries it to the Dash
 * line's new row even when that row now matches the policy it booked —
 * clearing it would leave a booked sale that nothing points at, and ask the
 * next person to book it again. Its row keeps asking until it is finished.
 * (The owner reopening the row, or deciding it by hand, still clears it: the
 * next start adopts the booked sale again, by its policy number.)
 */
export function isHeldOpen(outcome: RowOutcome | null | undefined): boolean {
  return outcome?.status === 'in_progress' && hasBooked(outcome);
}

/**
 * {@link isHeldOpen} as a filter on a row's `outcome` — for the writes that
 * pick rows by query rather than reading them first (work release). Kept
 * equal to it by `outcome-state.unit-spec.ts`.
 */
export const HELD_OPEN_OUTCOME = {
  'outcome.status': 'in_progress' as const,
  $or: [
    { 'outcome.dealId': { $type: 'string' as const } },
    { 'outcome.policyId': { $type: 'string' as const } },
  ],
};
