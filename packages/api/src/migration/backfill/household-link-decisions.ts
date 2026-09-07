import type { Types } from 'mongoose';
import type { ContactCsvRow } from './smartsuite-csv';

/**
 * The decision rules the PAC-91 backfill applies to every link, extracted from
 * the script so they can be tested without a database.
 *
 * The script itself calls `run()` at module load, so anything a test needs to
 * reach has to live here.
 */

/** What to do with one link field, given what is stored and what the export says. */
export type LinkDecision = 'fill' | 'already-correct' | 'conflict';

/**
 * "Fill, never move" — the rule the whole backfill turns on.
 *
 * An empty field is filled from the export. A field that already agrees is a
 * no-op, which is what makes a second run report zero fills. A field that
 * *disagrees* is the case where an employee has re-linked the record by hand
 * since go-live: the export is stale there, so it becomes a conflict row in the
 * report and nothing is written.
 */
export function decideLink(
  stored: Types.ObjectId | undefined | null,
  fromExport: Types.ObjectId,
): LinkDecision {
  if (!stored) return 'fill';
  return stored.toString() === fromExport.toString()
    ? 'already-correct'
    : 'conflict';
}

export type HouseholdTarget =
  | { kind: 'ok'; legacyHouseholdId: string }
  /** The export links this contact to no household on either side. */
  | { kind: 'unlinked-in-source' }
  /** Every household the export offers is one the owner decided to remove. */
  | { kind: 'target-removed' };

/**
 * The single household a contact's `householdId` should point at.
 *
 * Primary-first: a contact who is a household's primary belongs to that one,
 * even when the export also lists them as a member elsewhere. Households the
 * owner has decided to remove are skipped rather than chosen, so a link never
 * lands on a record that is about to be deleted — regardless of whether the
 * removals run before or after the fill.
 *
 * ⚠ This deliberately collapses a many-to-many fact into one field, because
 * that is the shape the schema has today. Nothing is lost: the household side
 * keeps every membership in `memberContactIds`, which is what Phase 3's join
 * collection is seeded from.
 */
export function pickTargetHousehold(
  row: ContactCsvRow,
  removedHouseholdIds: ReadonlySet<string>,
): HouseholdTarget {
  const candidates = [...row.primaryHouseholdIds, ...row.memberHouseholdIds];
  if (!candidates.length) return { kind: 'unlinked-in-source' };
  const target = candidates.find((id) => !removedHouseholdIds.has(id));
  return target
    ? { kind: 'ok', legacyHouseholdId: target }
    : { kind: 'target-removed' };
}

/**
 * Membership is the **union** of the two contact-side columns, per household.
 *
 * 266 contacts in the 2026-09-04 export are a household's primary without
 * appearing in its member list, so reading `Household Member` alone loses them.
 */
export function buildHouseholdMembership(rows: Iterable<ContactCsvRow>): {
  /** household rec id -> contact rec ids claiming to be its primary. */
  primaryContactsFor: Map<string, string[]>;
  /** household rec id -> every contact rec id linked to it, either way. */
  memberContactsFor: Map<string, Set<string>>;
} {
  const primaryContactsFor = new Map<string, string[]>();
  const memberContactsFor = new Map<string, Set<string>>();

  for (const row of rows) {
    for (const householdId of row.primaryHouseholdIds) {
      primaryContactsFor.set(householdId, [
        ...(primaryContactsFor.get(householdId) ?? []),
        row.recordId,
      ]);
    }
    for (const householdId of [
      ...row.primaryHouseholdIds,
      ...row.memberHouseholdIds,
    ]) {
      const members = memberContactsFor.get(householdId) ?? new Set<string>();
      members.add(row.recordId);
      memberContactsFor.set(householdId, members);
    }
  }

  return { primaryContactsFor, memberContactsFor };
}
