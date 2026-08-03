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

const ROLE_BY_LOWER = new Map<string, HouseholdMemberRole>(
  HOUSEHOLD_MEMBER_ROLES.map((role) => [role.toLowerCase(), role]),
);

/**
 * Resolve free-text (legacy or migrated) role values to the canonical set.
 * Returns `null` for anything unrecognized so callers can decide whether to
 * drop the value or keep the original — intake keeps the stored one rather than
 * overwriting a role a human already set.
 */
export function normalizeHouseholdRole(
  raw?: string | null,
): HouseholdMemberRole | null {
  if (!raw) return null;
  return ROLE_BY_LOWER.get(raw.trim().toLowerCase()) ?? null;
}
