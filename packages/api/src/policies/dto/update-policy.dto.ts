import { POLICY_TYPES } from '@sfa/shared';
import { z } from 'zod';

/**
 * `YYYY-MM-DD`, parsed as UTC midnight.
 *
 * Policy dates are calendar dates, not instants — the same rule `dateOnly` in
 * `lead-detail.service.ts` applies on the way out. Accepting a full ISO
 * timestamp here is what turns an effective date into the previous day for a
 * client in a negative-offset timezone.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((value) => !Number.isNaN(value.getTime()), 'Not a real date');

/**
 * A field that can be cleared as well as set.
 *
 * `null` and "absent" are different requests — a producer blanking a mistyped
 * carrier is not the same as one who only touched the premium — so the schema
 * has to keep them distinguishable rather than collapsing both to `undefined`.
 * An empty string is treated as a clear, because that is what a cleared text
 * input actually sends.
 */
function clearable<T extends z.ZodTypeAny>(inner: T) {
  return inner.nullable().optional();
}

const trimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length ? value : null));

/**
 * `PATCH /policies/:id` — the Sold card's quick edits (PAC-56 #27).
 *
 * Every field optional, object must not be empty: the dialog sends only what
 * the producer actually changed.
 *
 * `active`, `householdId` and `dealId` are absent on purpose — see
 * `UpdatePolicyInput` in `@sfa/shared` for why.
 */
export const updatePolicySchema = z
  .object({
    /**
     * Re-normalized into `policyNumberKey` by the service, so the duplicate
     * check keeps finding the policy after a correction. Not uniqueness-checked
     * — `PolicySchema`'s index is non-unique on purpose.
     */
    policyNumber: clearable(trimmedText(60)),
    /** Canonical labels only. Migrated raw codes are readable, not writable. */
    policyType: z.enum(POLICY_TYPES).optional(),
    carrier: clearable(trimmedText(120)),
    premium: z.number().min(0).max(1_000_000).optional(),
    items: z.number().int().min(0).max(100).optional(),
    effectiveDate: clearable(calendarDate),
    expirationDate: clearable(calendarDate),
    /** Free text — the platform has no canonical policy-status vocabulary. */
    status: clearable(trimmedText(60)),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdatePolicyDto = z.infer<typeof updatePolicySchema>;
