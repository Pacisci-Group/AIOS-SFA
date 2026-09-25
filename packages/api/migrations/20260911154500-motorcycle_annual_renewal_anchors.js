/**
 * Move motorcycle policies from the 6-month renewal track to 12 months.
 *
 * ## What was wrong
 *
 * The premium-term rule was introduced (2026-08-19) as "any auto vehicle is
 * quoted per 6 months", so `SEMIANNUAL_TERM_POLICY_TYPES` was seeded from
 * `AUTO_POLICY_TYPES` and Motorcycle came in with Auto and Auto - Special.
 * Motorcycle is written on a **12-month** term. Everything downstream inherited
 * the error, because `isSemiannualPolicyType` is the single authority:
 *
 *   - `policies.renewalDate` was derived on a 6-month term — by
 *     `20260908101946-backfill_renewal_anchors`, and by the policy write path
 *     ever since — so every motorcycle counts down to a renewal that is up to
 *     six months early.
 *   - A motorcycle-only cycle was put on the `semiannual` track, which merges
 *     the T-90 warm-up into the T-45 call. A 12-month policy should get both.
 *   - The premium rendered `/6 mo` and its form field asked for a "6-month
 *     premium", which misstates the producer's commission basis on screen.
 *
 * The vocabulary is fixed in `packages/shared/src/domain/policy-type.ts`, and
 * that fixes the label and the track by itself — both are computed per read.
 * **`renewalDate` is the one that is stored**, and nothing recomputes it on its
 * own: `rollForwardRenewalDates` only touches anchors that are null or already
 * past, so a motorcycle whose too-early date is still in the future would keep
 * it until somebody happened to edit the policy. Hence this migration.
 *
 * ## What this does
 *
 * Re-derives `renewalDate` for active motorcycle policies on a 12-month term,
 * from the same anchor the original backfill used:
 *
 *     anchor = effectiveDate ?? the policy's deal's soldDate
 *     renewalDate = anchor + n*12 months, for the smallest n landing on/after today
 *
 * A policy with neither date is left alone and reported — there is nothing to
 * count down to, and a guessed anchor would schedule real calls to real clients
 * on a date nobody chose.
 *
 * **Open renewal cycles are deliberately not touched.** Moving the anchor is a
 * date drift, and `reconcileRenewalCycle` already knows what to do with one: a
 * shift beyond `RENEWAL_DRIFT_TOLERANCE_DAYS` (45) closes the cycle as
 * `superseded` and the next scan opens a fresh one — on the annual track, with
 * both calls, because `trackForPolicies` is recomputed there too. A smaller
 * shift is adopted in place and the calls are re-planned. Closing cycles here
 * would duplicate that logic against a schema this file must not import.
 *
 * ## Notes
 *
 * - **Idempotent.** It derives from `effectiveDate`/`soldDate`, which it never
 *   writes, so a re-run computes the same values — and writes nothing the
 *   second time, since it only queues a policy whose stored date differs.
 * - The term rule is duplicated from `packages/shared/src/domain/policy-type.ts`
 *   for the same reason the backfill duplicates it: a migration is a frozen
 *   historical record and cannot import from `src/`. If the rule changes again,
 *   that is another migration, not an edit to this one.
 */

/**
 * Every spelling of Motorcycle that can be sitting in `policies.policyType`.
 *
 * `policyType` is a free-form string the SmartSuite import filled from two
 * different choice-code sets, so the label alone is not enough: `OMJjl` is Quote
 * Recaps' code and `gGKei` the Policies table's, and thousands of migrated rows
 * carry a code rather than a word. Missing one would leave those policies on the
 * 6-month anchor with nothing left to correct them.
 */
const MOTORCYCLE_TYPES = ['Motorcycle', 'OMJjl', 'gGKei'];

/** The term motorcycle now renews on, and the one it was wrongly given. */
const ANNUAL_MONTHS = 12;
const SEMIANNUAL_MONTHS = 6;

/**
 * Fold a free-form policy type to a comparison key: trimmed, lowercased, inner
 * whitespace collapsed, trailing plural dropped so "Motorcycles" matches.
 *
 * Identical to `termComparisonKey` in `policy-type.ts` and to the backfill's
 * `termKey`. The three must agree, or a row this migration corrects is one the
 * app still reads as semiannual.
 *
 * @param {unknown} value
 * @returns {string}
 */
function termKey(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return key.endsWith('s') ? key.slice(0, -1) : key;
}

// Built through `termKey` rather than written pre-folded, so the de-pluralizing
// rule cannot disagree with the literals.
const MOTORCYCLE_KEYS = new Set(MOTORCYCLE_TYPES.map(termKey));

/**
 * Midnight UTC on the day `date` falls in. Renewals are calendar days: a policy
 * renewing today has not renewed "already" because the clock passed midnight.
 *
 * @param {Date} date
 * @returns {Date}
 */
function startOfUtcDay(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * `date` shifted by whole calendar months, clamped to the end of the target
 * month.
 *
 * `setUTCMonth` overflows rather than clamping — 31 Jan + 1 month lands on 2 or
 * 3 March — which would walk a month-end policy forward a day or two every term.
 *
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function addUtcMonths(date, months) {
  const shifted = new Date(date.getTime());
  const dayOfMonth = date.getUTCDate();

  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() + months);

  // Day 0 of the next month is the last day of this one.
  const daysInTargetMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(dayOfMonth, daysInTargetMonth));

  return shifted;
}

/**
 * The next renewal on or after `now`, counted in whole terms from `anchor`.
 * Always measured from the original anchor so a month-end clamp cannot compound
 * into drift. Null when the anchor is unusable.
 *
 * Kept equivalent to `nextRenewalDate` in
 * `packages/shared/src/service/renewal.ts` — the app must keep computing the
 * same dates this migration writes, or the next scan forks every cycle.
 *
 * @param {Date | string | null | undefined} anchor
 * @param {number} months
 * @param {Date} now
 * @returns {Date | null}
 */
function nextRenewalDate(anchor, months, now) {
  if (!anchor) return null;
  const start = anchor instanceof Date ? anchor : new Date(anchor);
  if (Number.isNaN(start.getTime())) return null;

  const today = startOfUtcDay(now);

  for (let term = 0; term <= 200; term += 1) {
    const candidate = addUtcMonths(startOfUtcDay(start), term * months);
    if (candidate >= today) return candidate;
  }
  return null;
}

/**
 * Re-anchor every active motorcycle policy on `months`.
 *
 * Shared by `up` (12) and `down` (6) so the two cannot disagree about which
 * rows are motorcycles or where their anchor comes from — the asymmetry between
 * them is the term, and nothing else.
 *
 * @param {import('mongodb').Db} db
 * @param {number} months
 * @returns {Promise<void>}
 */
async function reanchorMotorcycles(db, months) {
  const now = new Date();
  const policies = await db
    .collection('policies')
    .find(
      { active: true },
      { projection: { policyType: 1, effectiveDate: 1, renewalDate: 1, dealId: 1 } },
    )
    .toArray();

  const motorcycles = policies.filter((policy) =>
    MOTORCYCLE_KEYS.has(termKey(policy.policyType)),
  );

  // One batched read of the deals actually referenced, rather than a query per
  // policy — this runs at API startup and blocks the port.
  const dealIds = [
    ...new Map(
      motorcycles
        .filter((policy) => !policy.effectiveDate && policy.dealId)
        .map((policy) => [String(policy.dealId), policy.dealId]),
    ).values(),
  ];
  const soldDateByDeal = new Map();
  if (dealIds.length) {
    const deals = await db
      .collection('deals')
      .find({ _id: { $in: dealIds } }, { projection: { soldDate: 1 } })
      .toArray();
    for (const deal of deals) {
      if (deal.soldDate) soldDateByDeal.set(String(deal._id), deal.soldDate);
    }
  }

  const writes = [];
  const report = { moved: 0, alreadyCorrect: 0, unanchored: 0 };

  for (const policy of motorcycles) {
    const anchor =
      policy.effectiveDate ??
      (policy.dealId ? soldDateByDeal.get(String(policy.dealId)) : null) ??
      null;

    const next = nextRenewalDate(anchor, months, now);
    if (!next) {
      report.unanchored += 1;
      continue;
    }

    // Only write a row whose date actually changes. That is what makes a re-run
    // after a half-applied failure a no-op rather than a second bulkWrite of
    // 1,200 identical updates — and it keeps the log honest about how many
    // policies this really moved.
    const stored = policy.renewalDate ? new Date(policy.renewalDate) : null;
    if (stored && stored.getTime() === next.getTime()) {
      report.alreadyCorrect += 1;
      continue;
    }

    report.moved += 1;
    writes.push({
      updateOne: {
        filter: { _id: policy._id },
        update: { $set: { renewalDate: next } },
      },
    });
  }

  if (writes.length) {
    await db.collection('policies').bulkWrite(writes, { ordered: false });
  }

  console.log(
    `[motorcycle-annual-renewal-anchors] ${motorcycles.length} active motorcycle policies: ` +
      `${report.moved} re-anchored on a ${months}-month term, ${report.alreadyCorrect} already correct.`,
  );
  if (report.unanchored) {
    console.log(
      `[motorcycle-annual-renewal-anchors] ${report.unanchored} have no effectiveDate and no deal ` +
        'soldDate — they keep whatever anchor they had and get no outreach until a date is entered by hand.',
    );
  }
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    await reanchorMotorcycles(db, ANNUAL_MONTHS);
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    // Puts back the 6-month anchors the backfill and the write path had been
    // deriving. Not a valuable state — it is the defect this migration exists
    // to fix — but it is the previous one, and it is exactly reconstructible
    // from `effectiveDate`, which is what makes a real `down` possible.
    //
    // ⚠ Rolling this back does NOT restore the semiannual *track*: that comes
    // from `SEMIANNUAL_TERM_POLICY_TYPES`, computed per read, so a rollback of
    // the data without a rollback of the code leaves motorcycles on 6-month
    // anchors reading as annual. Revert both together.
    await reanchorMotorcycles(db, SEMIANNUAL_MONTHS);
  },
};
