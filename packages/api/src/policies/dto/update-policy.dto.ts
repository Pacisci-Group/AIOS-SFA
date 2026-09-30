import {
  POLICY_STATUSES,
  POLICY_TYPES,
  isCanonicalPolicyStatus,
  normalizePolicyStatus,
} from '@sfa/shared';
import { z } from 'zod';
import { clearable, trimmedText } from '../../common/dto/clearable';

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
 * A policy status from the vocabulary, healed on the way in (PAC-126).
 *
 * This was `trimmedText(60)` with a comment saying the platform had no canonical
 * status list. PAC-80 built one; the comment simply outlived it, and free text
 * is now the wrong contract — David asked for staff to *select* a status, and a
 * select that can post anything is how a book grows a sixth spelling of
 * "Cancelled".
 *
 * Normalize **then** check, so the two forms a real client sends are both
 * accepted and stored canonically: a label in any casing (`'active'`), and a raw
 * SmartSuite code a migrated row handed the form (`'QsrnM'` → `'Active'`).
 *
 * ⚠ Rejects the uncatalogued codes `1943j` / `4krtk`, which ~thousands of
 * migrated policies still hold. That is the point — they must not be written
 * *back* — but it means a client must not round-trip a stored status it did not
 * change. The edit dialog sends `status` only when the operator picked a new
 * one, so an untouched migrated policy stays editable on its other fields.
 */
const policyStatusLabel = z
  .string()
  .trim()
  .max(60)
  .transform((value) => normalizePolicyStatus(value))
  .refine((value) => isCanonicalPolicyStatus(value), {
    message: `Unknown policy status. Use one of: ${POLICY_STATUSES.join(', ')}`,
  });

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
    /** A canonical label; raw codes and casing are healed. See {@link policyStatusLabel}. */
    status: clearable(policyStatusLabel),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdatePolicyDto = z.infer<typeof updatePolicySchema>;
