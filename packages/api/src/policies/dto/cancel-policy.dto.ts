import {
  POLICY_CANCELLATION_NOTE_MAX,
  POLICY_CANCELLATION_REASONS,
} from '@sfa/shared';
import { z } from 'zod';
import { ymd } from '../../common/dto/business-date.dto';

/**
 * The reason and its free text — what every way of cancelling a policy asks.
 * Shared with the Dash row's cancel (`cancelRowPolicySchema`, PAC-173 PR 6),
 * which asks the same and adds the carrier's date.
 */
export const cancelPolicyFields = z.object({
  reason: z.enum(POLICY_CANCELLATION_REASONS),
  note: z
    .string()
    .trim()
    .max(POLICY_CANCELLATION_NOTE_MAX, 'Keep the reason under 500 characters')
    .nullable()
    .optional(),
});

/** `'other'` is the reason that has to say what it means. */
export function otherHasNote(value: {
  reason: string;
  note?: string | null;
}): boolean {
  return value.reason !== 'other' || Boolean(value.note);
}

export const OTHER_NEEDS_NOTE = {
  message: 'Say why the policy was cancelled.',
  path: ['note'],
};

/** The free text, kept for `'other'` only — see `CancelPolicyInput`. */
export function cancellationNote(value: {
  reason: string;
  note?: string | null;
}): string | null {
  return value.reason === 'other' ? (value.note ?? null) : null;
}

/**
 * `POST /households/:id/policies/:policyId/cancel` — the Cancel button.
 *
 * The reason is a vocabulary, and `'other'` is the one that has to say what it
 * means: it requires the free text, and the free text is **dropped** for every
 * named reason rather than stored beside it (see `CancelPolicyInput`).
 *
 * **No date, unless a chargeback is recorded.** A plain cancel is stamped with
 * server time when it is recorded, like `uploadedAt` on a policy document —
 * the client's clock is not a source for when something happened on the
 * server. `chargeback.cancelledOn` is a different fact: **the carrier's**
 * cancellation date, which the person reads off the carrier's notice. It
 * decides the one-month clawback window (David, 27 Oct 2026), so it is asked
 * for only when a chargeback is, and bounded by the service (not in the
 * future, not before the sale).
 */
export const cancelPolicySchema = cancelPolicyFields
  .extend({
    chargeback: z.object({ cancelledOn: ymd }).nullable().optional(),
  })
  .refine(otherHasNote, OTHER_NEEDS_NOTE)
  .transform((value) => ({
    reason: value.reason,
    note: cancellationNote(value),
    chargeback: value.chargeback ?? null,
  }));

export type CancelPolicyDto = z.infer<typeof cancelPolicySchema>;
