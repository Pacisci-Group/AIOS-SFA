import {
  POLICY_CANCELLATION_NOTE_MAX,
  POLICY_CANCELLATION_REASONS,
} from '@sfa/shared';
import { z } from 'zod';

/**
 * `POST /households/:id/policies/:policyId/cancel` — the Cancel button.
 *
 * The reason is a vocabulary, and `'other'` is the one that has to say what it
 * means: it requires the free text, and the free text is **dropped** for every
 * named reason rather than stored beside it (see `CancelPolicyInput`).
 *
 * No date: the cancellation is stamped with server time when it is recorded,
 * like `uploadedAt` on a policy document — the client's clock is not a source
 * for when something happened on the server.
 */
export const cancelPolicySchema = z
  .object({
    reason: z.enum(POLICY_CANCELLATION_REASONS),
    note: z
      .string()
      .trim()
      .max(POLICY_CANCELLATION_NOTE_MAX, 'Keep the reason under 500 characters')
      .nullable()
      .optional(),
  })
  .refine((value) => value.reason !== 'other' || Boolean(value.note), {
    message: 'Say why the policy was cancelled.',
    path: ['note'],
  })
  .transform((value) => ({
    reason: value.reason,
    note: value.reason === 'other' ? (value.note ?? null) : null,
  }));

export type CancelPolicyDto = z.infer<typeof cancelPolicySchema>;
