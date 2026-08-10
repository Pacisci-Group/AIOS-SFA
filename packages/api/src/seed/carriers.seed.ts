import { carrierSlug } from '@sfa/shared';
import { Model } from 'mongoose';
import { Carrier } from '../carriers/schemas/carrier.schema';

/**
 * The platform-global carrier catalog (PAC-56 #19).
 *
 * ## Why this is core seed data
 *
 * `GET /carriers` is the only source for the Sold wizard's carrier select. An
 * empty collection means an empty dropdown, which means every sale has to go
 * through the "Other" escape — the regression #18 exists to fix.
 *
 * ## Where the list came from — and where it did not
 *
 * ⚠ **Not from migrated data.** Legacy's Policies `Carrier` (`s33be9b77d`) is a
 * single-select with exactly one choice, `B4tEH` = Allstate, and the
 * prior-insurance carrier fields were plain strings. So Allstate is the only
 * name here with legacy authority; the other sixteen are our proposal and should
 * be put to the agency owner.
 *
 * They are chosen for two jobs, because the same catalog backs both the sold
 * policy's carrier and `priorInsurance.carrier`:
 *   - Allstate — the agency's own carrier, and what it writes.
 *   - The US personal-lines majors — who a switching client is switching *from*.
 *   - Oklahoma and independent-channel names (Shelter, Oklahoma Farm Bureau,
 *     Safeco, Foremost, Auto-Owners) that would otherwise force "Other" on
 *     routine cases in this agency's actual market.
 *
 * The list stops well short of exhaustive on purpose. "Other" is the safety
 * valve, so the bar is "common cases covered", not "nothing missing".
 *
 * ## Why only one pattern
 *
 * A policy-number rule that is wrong fails **closed** — it blocks a real sale,
 * and with no admin UI the only fix is a deploy. Allstate is digits-only, which
 * we know; we do not know its length, and we know nothing about the others. So
 * exactly one carrier carries a pattern, and it is as loose as the fact we have.
 */
export interface CoreCarrierSpec {
  name: string;
  /** Unanchored regex source, tested against the normalized policy-number key. */
  policyNumberPattern?: string;
  policyNumberHint?: string;
}

export const CORE_CARRIERS: CoreCarrierSpec[] = [
  {
    name: 'Allstate',
    // Digits only. Deliberately no length bound — see the note above.
    policyNumberPattern: '\\d+',
    policyNumberHint: 'Allstate policy numbers are digits only.',
  },
  { name: 'State Farm' },
  { name: 'GEICO' },
  { name: 'Progressive' },
  { name: 'USAA' },
  { name: 'Liberty Mutual' },
  { name: 'Farmers' },
  { name: 'Travelers' },
  { name: 'American Family' },
  { name: 'Nationwide' },
  { name: 'Shelter Insurance' },
  { name: 'Oklahoma Farm Bureau' },
  { name: 'Safeco' },
  { name: 'Foremost' },
  { name: 'Auto-Owners' },
  { name: 'The Hartford' },
  { name: 'Chubb' },
];

/**
 * Upsert the global catalog. Idempotent and safe to re-run.
 *
 * Keyed on `{ agencyId: null, slug }`. Two deliberate choices, both copied from
 * `seedAuditTemplates` for the same reasons:
 *
 *   - `active` is `$setOnInsert` only. An agency that switched a carrier off has
 *     made a decision; a re-seed must not silently re-enable it.
 *   - `policyNumberPattern` / `policyNumberHint` are `$set` **and** explicitly
 *     `$unset` when absent, so removing a pattern from this file actually
 *     removes it from the database rather than leaving a stale rule enforcing
 *     itself forever.
 *
 * `displayOrder` is the array index, so Allstate sorts first.
 */
export async function seedCarriers(
  carrierModel: Model<Carrier>,
): Promise<{ created: number; refreshed: number }> {
  let created = 0;
  let refreshed = 0;

  for (const [index, carrier] of CORE_CARRIERS.entries()) {
    const slug = carrierSlug(carrier.name);
    const set: Record<string, unknown> = {
      name: carrier.name,
      displayOrder: index,
    };
    const unset: Record<string, ''> = {};

    if (carrier.policyNumberPattern) {
      set.policyNumberPattern = carrier.policyNumberPattern;
    } else {
      unset.policyNumberPattern = '';
    }
    if (carrier.policyNumberHint) {
      set.policyNumberHint = carrier.policyNumberHint;
    } else {
      unset.policyNumberHint = '';
    }

    const result = await carrierModel.updateOne(
      { agencyId: null, slug },
      {
        $set: set,
        $unset: unset,
        // Only on insert — see the note above about not re-enabling.
        $setOnInsert: { agencyId: null, slug, active: true },
      },
      { upsert: true },
    );

    // `modifiedCount` cannot distinguish a real change from a no-op: with
    // `timestamps: true`, every `$set` also writes `updatedAt`.
    if (result.upsertedCount > 0) created += 1;
    else refreshed += 1;
  }

  return { created, refreshed };
}
