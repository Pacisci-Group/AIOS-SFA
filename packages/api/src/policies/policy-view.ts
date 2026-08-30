import {
  normalizeCarrier,
  normalizePolicyStatus,
  normalizePolicyType,
} from '@sfa/shared';
import type { LeadDetailPolicy } from '@sfa/shared';
import { PolicyDocument } from './schemas/policy.schema';

/**
 * The one `Policy` → wire mapper.
 *
 * Two endpoints now return this shape — `GET /leads/:id` (the household roster
 * and the Sold card) and `PATCH /policies/:id`, which hands the saved row
 * straight back so the client can swap it in place. A second copy would drift:
 * the normalization on `policyType` and the calendar-date truncation are both
 * easy to forget and invisible when omitted.
 */
export function toLeadDetailPolicy(policy: PolicyDocument): LeadDetailPolicy {
  return {
    id: policy._id.toString(),
    // Migrated docs hold raw SmartSuite choice codes; the app writes labels.
    policyType: normalizePolicyType(policy.policyType),
    // Same story for the carrier: the migration stored `B4tEH`, which rendered
    // verbatim to users until PAC-56 #19 gave us the vocabulary to map it.
    carrier: normalizeCarrier(policy.carrier) || null,
    policyNumber: policy.policyNumber ?? null,
    active: policy.active ?? false,
    // And the same again for the status, which had no vocabulary to map against
    // until PAC-80 — 3,998 of 4,327 migrated policies rendered `QsrnM` here.
    status: normalizePolicyStatus(policy.policyStatus) || null,
    premium: policy.premium ?? 0,
    items: policy.items ?? 0,
    effectiveDate: policyDate(policy.effectiveDate),
    expirationDate: policyDate(policy.expirationDate),
  };
}

/**
 * `YYYY-MM-DD` in UTC, or `null`.
 *
 * Policy dates are calendar dates. Returning the full ISO instant is how an
 * effective date becomes the previous day once a US client renders it.
 */
function policyDate(value?: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
