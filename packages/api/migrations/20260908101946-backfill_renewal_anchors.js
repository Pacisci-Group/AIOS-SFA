/**
 * Give every active policy a real next-renewal date, so proactive renewal
 * outreach can finally schedule calls.
 *
 * ## What was wrong
 *
 * `policies.renewalDate` is the anchor every renewal call counts backwards from
 * — T-90 Annual Review, T-45 Renewal Review. Two independent defects meant it
 * never held a usable value:
 *
 *   1. **The SmartSuite import wrote the wrong date.** Legacy's Renewal Date
 *      column had been filled with the *effective* date: across the whole book,
 *      every policy carrying both had them exactly **one day** apart. So these
 *      were never forward-looking dates to roll on — they were a copy of when
 *      coverage began, and all of them were in the past.
 *   2. **No write path set it at all.** The Sold form wrote `effectiveDate`
 *      only, so every policy sold through the app was born with no anchor.
 *
 * The result: `findRenewalWindow` looks for renewals in `[now−14d, now+90d]`,
 * every stored date was historical, and the scan matched nothing. Zero renewal
 * cycles and zero renewal tickets had ever been created.
 *
 * ## What this does
 *
 * Recomputes `renewalDate` as the next occurrence of the policy's term, counted
 * in whole calendar months from the date coverage began:
 *
 *     anchor = effectiveDate ?? the policy's deal's soldDate
 *     term   = 6 months for the auto family, 12 for everything else
 *     renewalDate = anchor + n*term, for the smallest n landing on/after today
 *
 * The `soldDate` fallback is what recovers the ~974 active policies the import
 * left with no `effectiveDate` at all — the deal records when the client
 * actually bought, which is the same day coverage started.
 *
 * A policy with neither is **left alone and reported**. There is nothing to
 * count down to, and a guessed anchor would schedule real calls to real clients
 * on a date nobody chose.
 *
 * ## Notes
 *
 * - **Idempotent.** It derives from `effectiveDate`/`soldDate`, which it never
 *   writes, so a re-run computes the same values. That matters more than usual
 *   here: a failed migration is not recorded and retries from the top.
 * - **Nothing is destroyed.** `effectiveDate` is untouched, and the value being
 *   overwritten is the effective-date copy described above — recoverable from
 *   `effectiveDate` itself, which is why `down` can restore it.
 * - The term rule is duplicated from `packages/shared/src/domain/policy-type.ts`
 *   (`SEMIANNUAL_TERM_POLICY_TYPES`) because a migration is a **frozen
 *   historical record** and cannot import from `src/` — it is CommonJS, that is
 *   TypeScript compiled into the webpack bundle. If the term rule changes
 *   later, that is a new migration, not an edit to this one.
 */

/**
 * Policy types quoted on a 6-month term, as comparison keys.
 *
 * Mirrors `AUTO_POLICY_TYPES` plus the raw SmartSuite choice codes that alias
 * to them. The codes matter: `policyType` is a free-form string and the import
 * left thousands of rows holding a code (`Zgsh3`) rather than a label. Missing
 * one would put a 6-month auto policy on the annual track and schedule its
 * calls half a year late.
 */
const SEMIANNUAL_TYPES = [
  'Auto',
  'Auto - Special',
  'Motorcycle',
  // Policies single-select codes.
  'Zgsh3',
  'gGKei',
  // Quote Recaps codes, which some rows carry too.
  'PYgez',
  'OMJjl',
  'UAOk8',
];

/**
 * Everything catalogued that renews annually — labels and choice codes alike.
 *
 * Used only to decide whether a type is *known*. A type in neither set still
 * gets scheduled (annually, the safe default) but is named in the report, since
 * an auto policy hiding among them would renew twice as often as scheduled.
 */
const ANNUAL_TYPES = [
  'Home',
  'Renters',
  'Condominium',
  'Landlord',
  'Boat Owners',
  'Umbrella',
  'Life',
  'Valuable Item Protection',
  // Label aliases already sitting in Mongo.
  'Condo',
  // Policies single-select codes.
  'eCEuV',
  'F3oxm',
  'le1BC',
  // Quote Recaps + Deals codes.
  'sNMRK',
  'Hn155',
  'mrzQD',
  'mCt4m',
  'NlLBc',
  'fltex',
  'EGGWR',
  'uBjtw',
  'AiFB5',
];

/**
 * Fold a free-form policy type to a comparison key: trimmed, lowercased, inner
 * whitespace collapsed, trailing plural dropped so "Autos" matches "Auto".
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
// rule cannot disagree with the literals ("Boat Owners" folds to "boat owner").
const SEMIANNUAL_KEYS = new Set(SEMIANNUAL_TYPES.map(termKey));
const KNOWN_ANNUAL_KEYS = new Set(ANNUAL_TYPES.map(termKey));

/**
 * The term this policy renews on, in months. An unrecognized type answers 12 —
 * the safer guess, and the same default the app makes.
 *
 * @param {unknown} policyType
 * @returns {number}
 */
function termMonths(policyType) {
  return SEMIANNUAL_KEYS.has(termKey(policyType)) ? 6 : 12;
}

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
 * Kept byte-for-byte equivalent to `nextRenewalDate` in
 * `packages/shared/src/service/renewal.ts` — the app must keep computing the
 * same dates this migration wrote, or every cycle would fork on the next scan.
 *
 * @param {Date | null | undefined} anchor
 * @param {unknown} policyType
 * @param {Date} now
 * @returns {Date | null}
 */
function nextRenewalDate(anchor, policyType, now) {
  if (!anchor) return null;
  const start = anchor instanceof Date ? anchor : new Date(anchor);
  if (Number.isNaN(start.getTime())) return null;

  const months = termMonths(policyType);
  const today = startOfUtcDay(now);

  for (let term = 0; term <= 200; term += 1) {
    const candidate = addUtcMonths(startOfUtcDay(start), term * months);
    if (candidate >= today) return candidate;
  }
  return null;
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const now = new Date();
    const policies = await db
      .collection('policies')
      .find(
        { active: true },
        { projection: { policyType: 1, effectiveDate: 1, dealId: 1 } },
      )
      .toArray();

    // One batched read of the deals actually referenced, rather than a query
    // per policy — this runs at API startup and blocks the port.
    const dealIds = [
      ...new Map(
        policies
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
    const report = { fromEffectiveDate: 0, fromSoldDate: 0, unanchored: 0 };
    /** Types we could not catalogue, so a human can resolve them at source. */
    const uncataloguedTypes = new Map();

    for (const policy of policies) {
      const anchor =
        policy.effectiveDate ??
        (policy.dealId ? soldDateByDeal.get(String(policy.dealId)) : null) ??
        null;

      const next = nextRenewalDate(anchor, policy.policyType, now);
      if (!next) {
        report.unanchored += 1;
        continue;
      }

      // A type that is neither a known label nor a known code still gets a
      // date — on the annual track, the documented safe default — but it is
      // worth naming, because an auto policy hiding in here renews twice as
      // often as it has been scheduled for.
      const key = termKey(policy.policyType);
      if (key && !SEMIANNUAL_KEYS.has(key) && !KNOWN_ANNUAL_KEYS.has(key)) {
        uncataloguedTypes.set(
          policy.policyType,
          (uncataloguedTypes.get(policy.policyType) ?? 0) + 1,
        );
      }

      if (policy.effectiveDate) report.fromEffectiveDate += 1;
      else report.fromSoldDate += 1;

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
      `[backfill-renewal-anchors] anchored ${writes.length} of ${policies.length} active policies ` +
        `(${report.fromEffectiveDate} from effectiveDate, ${report.fromSoldDate} from the deal's soldDate).`,
    );
    if (report.unanchored) {
      console.log(
        `[backfill-renewal-anchors] ${report.unanchored} active policies have no effectiveDate and no ` +
          'deal soldDate — they get no renewal outreach until a date is entered by hand.',
      );
    }
    if (uncataloguedTypes.size) {
      const summary = [...uncataloguedTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `${type}=${count}`)
        .join(' ');
      console.log(
        `[backfill-renewal-anchors] scheduled as annual, but the policy type is uncatalogued: ${summary}. ` +
          'Resolve these at source — an auto policy among them renews every 6 months, not 12.',
      );
    }
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    // Restores what the import had put here: a copy of the effective date.
    // Not a valuable state — it is the defect this migration exists to fix —
    // but it is the previous one, and it is exactly reconstructible, which is
    // what makes writing a real `down` possible at all.
    await db
      .collection('policies')
      .updateMany({ active: true, effectiveDate: { $ne: null } }, [
        { $set: { renewalDate: '$effectiveDate' } },
      ]);
    await db
      .collection('policies')
      .updateMany(
        { active: true, effectiveDate: null },
        { $unset: { renewalDate: '' } },
      );
  },
};
