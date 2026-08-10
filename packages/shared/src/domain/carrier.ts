/**
 * Carrier catalog (PAC-56 #19).
 *
 * ## Why a collection and not a constant
 *
 * The Sold wizard's carrier used to be free text, which is a regression we
 * introduced — legacy's Policies `Carrier` (`s33be9b77d`) was already a
 * single-select. It is a select again (#18), and the vocabulary has to be data
 * rather than a shipped constant because super admins and agency owners will
 * eventually curate it from an admin surface.
 *
 * ⚠ The catalog **cannot be seeded from migrated data**: legacy's select has
 * exactly one choice, `B4tEH` = Allstate. Everything else in the seed list is
 * our proposal, which is why {@link CARRIER_OTHER} exists — an unseeded carrier
 * must never block a sale.
 *
 * ## Two kinds of row
 *
 * A carrier document carries `agencyId: string | null`. `null` is a
 * platform-seeded global row visible to every agency; a non-null value is that
 * agency's own addition. Only globals are seeded today — agency rows are the
 * slot the future agency-owner CRUD writes into, and the read endpoint already
 * unions the two.
 *
 * ## What gets stored on a policy
 *
 * The **display name**, not an id. `Policy.carrier` is a free string holding
 * migrated codes, demo-seed labels and hand-typed corrections, and several
 * readers compare it by name (`derivePriorCarriers`). The catalog constrains
 * what can be *picked*; it does not change the wire or storage shape.
 */

/**
 * One selectable carrier, as `GET /carriers` returns it.
 *
 * `policyNumberPattern` is a regex **source** and deliberately unanchored — see
 * {@link carrierPolicyNumberMatches}, which anchors it at the point of use so a
 * pattern can never accidentally match a substring.
 */
export interface CarrierOption {
  id: string;
  name: string;
  /** `null` = this carrier imposes no policy-number format. */
  policyNumberPattern: string | null;
  /** Human-readable statement of the rule, shown when the pattern rejects. */
  policyNumberHint: string | null;
}

export interface CarrierListResponse {
  carriers: CarrierOption[];
}

/**
 * The wizard's "Other" choice.
 *
 * A sentinel in *form state only*. `toPolicyInput` swaps it for the typed name
 * before submission, and the API rejects it outright, so it can never reach the
 * database as a carrier name.
 */
export const CARRIER_OTHER = '__other__';

/**
 * Dedupe key for a carrier name: lowercased, non-alphanumerics collapsed to a
 * single hyphen. Server-side only — it backs the unique index and matches a
 * submitted display name back to its catalog row.
 */
export function carrierSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * SmartSuite choice codes → display name.
 *
 * The migration stores `selectCode(...)` for a policy's carrier, so every
 * migrated policy holds the raw code `B4tEH` and renders it verbatim to the
 * user. Mapped at write and normalized on read, the same treatment
 * `normalizePolicyType` gives policy types.
 */
export const CARRIER_CODE_ALIASES: Record<string, string> = {
  B4tEH: 'Allstate',
};

/**
 * Stored value → display name. Unrecognized non-empty values pass through
 * trimmed, so a carrier typed through "Other" still renders as itself.
 */
export function normalizeCarrier(raw?: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  return CARRIER_CODE_ALIASES[value] ?? value;
}

/**
 * Does `normalizedPolicyNumber` satisfy this carrier's format rule?
 *
 * Two things this deliberately does:
 *
 * - **Anchors the stored pattern.** Patterns are stored unanchored so an author
 *   cannot forget the anchors and ship a rule that matches any string
 *   containing a valid one.
 * - **Tests the normalized key**, not the raw input, so `123-456` satisfies a
 *   digits-only rule. That matches how the number is stored and looked up
 *   (`policyNumberKey`), and refusing punctuation nobody stores would be a rule
 *   about typing rather than about policy numbers.
 *
 * A carrier with no pattern, or an unparseable one, passes. A regex that fails
 * to compile is a seeding bug, and blocking a sale over it would be the wrong
 * trade.
 */
export function carrierPolicyNumberMatches(
  pattern: string | null | undefined,
  normalizedPolicyNumber: string,
): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(`^(?:${pattern})$`).test(normalizedPolicyNumber);
  } catch {
    return true;
  }
}
