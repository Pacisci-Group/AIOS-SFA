/**
 * Distinct household identity for a sold deal or a quote recap, with a fallback
 * ladder. An aggregation expression — `$addToSet` it to count households.
 *
 * `$toString` of a missing field is null and `$concat` with a null operand is
 * null, so the three-arm `$ifNull` reads as: the real ref if present, else the
 * legacy string id, else the row's own id.
 *
 * That last arm means an unattributed row counts as *its own* household. The
 * alternatives are both worse: collapsing every null-household row into one
 * bucket inflates the average without bound on migrated data, and dropping them
 * counts their premium in the numerator while omitting them from the
 * denominator. Counting each separately can only understate the average, and
 * rows the migration did resolve a household for are counted correctly.
 *
 * The `h:`/`l:`/`r:` prefixes stop a legacy string id from ever colliding with a
 * stringified ObjectId.
 *
 * Shared rather than inlined because the Producer scorecard (PAC-10/11) and the
 * Owner dashboard (PAC-135) both report "average premium per household", and
 * two copies of this ladder are two definitions of a household waiting to
 * disagree on the same screen-share.
 */
export const HOUSEHOLD_KEY_EXPR = {
  $ifNull: [
    { $concat: ['h:', { $toString: '$householdId' }] },
    { $concat: ['l:', '$legacyHouseholdId'] },
    { $concat: ['r:', { $toString: '$_id' }] },
  ],
} as const;
