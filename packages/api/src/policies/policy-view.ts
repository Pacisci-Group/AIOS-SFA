import {
  normalizeCarrier,
  normalizePolicyStatus,
  normalizePolicyType,
} from '@sfa/shared';
import type { LeadDetailPolicy, PolicySummary } from '@sfa/shared';
import { Policy } from './schemas/policy.schema';
import { PolicyDocument } from './schemas/policy.schema';

/**
 * The `Policy` → wire mappers. **Two shapes, on purpose** — see
 * {@link toPolicySummary} for what separates them.
 *
 * Two endpoints return this one — `GET /leads/:id` (the household roster
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
 * A policy as it appears **inside a household** — the Clients pages, the ticket
 * Policy drawer, and the row `PATCH /households/:id/policies/:policyId` hands
 * back (PAC-126).
 *
 * Lived in `clients.service.ts` until PAC-126 gave the household page a write
 * path, which needed to return this shape from `PoliciesService`. Moved here
 * beside its sibling rather than exported out of a 1,100-line read service.
 *
 * ## Why this is not {@link toLeadDetailPolicy}
 *
 * It carries **`renewalDate`**, which `LeadDetailPolicy` has no field for. That
 * is the anchor the whole renewal desk counts backwards from and the date
 * PAC-126 exists to put in front of people, so the household's mapper is the one
 * that must not lose it. Its dates are also full ISO instants rather than
 * `YYYY-MM-DD` — a difference the two wire contracts already declare, not one to
 * quietly reconcile here.
 */
export function toPolicySummary(
  policy: Policy & { _id: unknown },
): PolicySummary {
  return {
    id: String(policy._id),
    policyNumber: policy.policyNumber ?? null,
    policyType: normalizePolicyType(policy.policyType) || null,
    carrier: normalizeCarrier(policy.carrier) || null,
    active: policy.active ?? false,
    policyStatus: normalizePolicyStatus(policy.policyStatus) || null,
    premium: policy.premium ?? 0,
    items: policy.items ?? 0,
    effectiveDate: toIso(policy.effectiveDate),
    expirationDate: toIso(policy.expirationDate),
    renewalDate: toIso(policy.renewalDate),
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

/** The full instant, which is what `PolicySummary` declares. */
function toIso(value: Date | undefined | null): string | null {
  return value ? new Date(value).toISOString() : null;
}
