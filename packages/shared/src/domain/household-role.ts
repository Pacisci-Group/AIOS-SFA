/**
 * Household-member relationship vocabulary (PAC-37).
 *
 * Shared because the New Lead form renders these as the member-row dropdown and
 * the intake pipeline writes them to `contacts.roleInHousehold`, which is a free
 * string on the schema — this is the only thing keeping the two sides in step.
 *
 * The `./sfaforms` prototype offers only three roles; **Child is missing there**
 * and is required here.
 */
export const HOUSEHOLD_MEMBER_ROLES = [
  'Spouse',
  'Child',
  'Driver',
  'Additional Named Insured',
] as const;

export type HouseholdMemberRole = (typeof HOUSEHOLD_MEMBER_ROLES)[number];

/**
 * The primary contact's role. Not selectable in the form — it's implied by
 * `contacts.isPrimary`, and intake stamps it on create.
 */
export const PRIMARY_HOUSEHOLD_ROLE = 'Named Insured';

/**
 * SmartSuite's Role in Household choices (PAC-80) —
 * `docs/smartsuite-tables/The Contacts Table.md:23`, field `se79ae4f7f`.
 *
 * 1,022 of 3,064 migrated contacts stored one of these codes raw. It showed:
 * `clients.service.ts` and `lead-detail.service.ts` render the value straight
 * through, and `start-quote-prefill.ts` matched it against the canonical labels
 * and fell back to "Driver" — so **every** migrated contact prefilled the quote
 * form as a driver.
 *
 * Two decisions worth stating:
 *
 * - **Both named-insured codes collapse onto {@link PRIMARY_HOUSEHOLD_ROLE}.**
 *   SmartSuite has `iqGZ5` "Name Insured" (sic, missing the *d*) and `lzh7a`
 *   "Named Insured" — one concept, spelt twice. They map to the same label the
 *   intake pipeline already stamps on a primary contact, so a migrated primary
 *   and an app-created one agree. Deliberately *not* "Additional Named Insured",
 *   which is a different role in the form vocabulary.
 * - **`Parent` and `Other` are stored but not offered.** They are real values a
 *   migrated contact carries, so they must round-trip; they are not added to
 *   {@link HOUSEHOLD_MEMBER_ROLES} because that drives the New Lead form's
 *   dropdown, and widening it would silently add two options nobody asked for.
 */
export const HOUSEHOLD_ROLE_CODE_ALIASES: Record<string, string> = {
  iqGZ5: PRIMARY_HOUSEHOLD_ROLE,
  lzh7a: PRIMARY_HOUSEHOLD_ROLE,
  W7qil: 'Spouse',
  '5ddmB': 'Driver',
  fZHxn: 'Child',
  ZOVDs: 'Parent',
  SCJxW: 'Other',
};

/**
 * Every role a *stored* contact may carry — wider than the form's dropdown,
 * because migrated data holds two roles the form never offered.
 */
export const CONTACT_ROLES = [
  ...HOUSEHOLD_MEMBER_ROLES,
  PRIMARY_HOUSEHOLD_ROLE,
  'Parent',
  'Other',
] as const;

const CONTACT_ROLE_BY_LOWER = new Map<string, string>(
  CONTACT_ROLES.map((role) => [role.toLowerCase(), role]),
);

/**
 * Stored value → display label, over the full stored vocabulary.
 *
 * Lenient on purpose: unrecognized values pass through trimmed, so a role we
 * have not catalogued renders as itself. Use this for **display and for the
 * migration write**; use {@link normalizeHouseholdRole} where the caller needs
 * to know whether the value is one the *form* can offer.
 */
export function normalizeContactRole(raw?: string | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  return (
    HOUSEHOLD_ROLE_CODE_ALIASES[value] ??
    CONTACT_ROLE_BY_LOWER.get(value.toLowerCase()) ??
    value
  );
}

const ROLE_BY_LOWER = new Map<string, HouseholdMemberRole>(
  HOUSEHOLD_MEMBER_ROLES.map((role) => [role.toLowerCase(), role]),
);

/**
 * Resolve free-text (legacy or migrated) role values to the canonical set.
 * Returns `null` for anything unrecognized so callers can decide whether to
 * drop the value or keep the original — intake keeps the stored one rather than
 * overwriting a role a human already set.
 *
 * Runs {@link normalizeContactRole} first, so a raw choice code resolves before
 * the canonical check. `5ddmB` now answers `'Driver'` where it used to answer
 * `null`. `Parent`, `Other` and `Named Insured` still answer `null` — they are
 * real stored roles but not form options, and that distinction is what callers
 * like `start-quote-prefill` rely on to fall back.
 */
export function normalizeHouseholdRole(
  raw?: string | null,
): HouseholdMemberRole | null {
  const value = normalizeContactRole(raw);
  if (!value) return null;
  return ROLE_BY_LOWER.get(value.toLowerCase()) ?? null;
}
