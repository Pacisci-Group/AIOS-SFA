/**
 * PAC-106 — the manager's side of the deal audit.
 *
 * ## Why
 *
 * The Deal Audit page splits the checklist (David, 24 Aug): the manager sees
 * every item; the producer's hand-off board shows only the items that need
 * their input. That split is two flags per template, copied onto every item —
 * `producerVisible` and `requiresUpload` — and the board now reads three new
 * roll-ups over the producer's items (`producerItemCount`,
 * `producerResolvedCount`, `producerOpenCount`). Every document that predates
 * PAC-106 has none of them.
 *
 * ## What it does, in order
 *
 * 1. **Templates** lacking the flags get them by name — David's table, copied
 *    below. A name not in it (an agency's own template) gets the schema
 *    default: visible, no file.
 * 2. **Items** lacking the flags get their template's (by `templateId`), else
 *    the same table by item name — a migrated item has no `templateId`, and
 *    legacy named some items without the Home / Landlord prefix. Every item
 *    also gets `reviewVerdict: null` ("not yet reviewed") where it has none.
 * 3. **Counters**: the three producer roll-ups on every `dealAudits` row,
 *    recomputed from its items with the same rule as `syncAuditCounters`
 *    (`IS_PRODUCER_ACTIONABLE`). An audit with no items gets zeros.
 * 4. **Auto-submit**: a `Not Submitted` audit with **no producer items** goes
 *    to `Pending` with `submittedById: null` — what generation now does for a
 *    new sale. Without it these audits would wait forever on a submit the
 *    producer has no reason to click, and never reach the manager. The count
 *    is logged; compare it on the rehearsal dump before deploying.
 *
 * ## Idempotent
 *
 * Steps 1 and 2 match only documents missing the field. Step 3 recomputes and
 * overwrites, converging on every run. Step 4 matches only `Not Submitted`,
 * which it moves away from.
 *
 * ⚠ The name table and `ACTIONABLE` are **copied in, not imported**
 * (`src/audit-generation/audit-visibility.ts`, `src/seed/audit-templates.seed.ts`,
 * `src/deal-audits/audit-counters.ts`): no TypeScript build is in this path,
 * and an applied migration must keep doing in a year what it did today.
 */

/** `[producerVisible, requiresUpload]` by normalised name. */
const FLAGS_BY_NAME = {
  // Manager-only: checked against the application, nothing for the producer.
  'correct sold date': [false, false],
  'correct effective date': [false, false],
  'quote recap': [false, false],
  'lead manager': [false, false],
  'evidence of insurance': [false, false],
  'drivers verified': [false, false],
  // Retired by PAC-65 (nothing can prove enrolment); the manager passes it.
  drivewise: [false, false],
  // The producer uploads the proof.
  'good student': [true, true],
  'prior insurance': [true, true],
  'accord cancellation': [true, true],
  'defensive driver': [true, true],
  'home fire subscription': [true, true],
  'landlord fire subscription': [true, true],
  'fire subscription': [true, true],
  'home hail resistant roof': [true, true],
  'landlord hail resistant roof': [true, true],
  'hail resistant roof': [true, true],
  // The producer answers yes/no; no upload.
  'home inspection': [true, false],
  'landlord inspection': [true, false],
  'home actual cash value': [true, false],
  'landlord actual cash value': [true, false],
  'actual cash value': [true, false],
  'home mortgagee': [true, false],
  'landlord mortgagee': [true, false],
  '(mortgagee) escrow payment': [true, false],
};

const DEFAULT_FLAGS = [true, false];

/** `Defensive Driver — Sam` → `defensive driver`. */
function normalizeName(name) {
  return String(name || '')
    .split(' — ')[0]
    .trim()
    .toLowerCase();
}

function flagsForName(name) {
  return FLAGS_BY_NAME[normalizeName(name)] || DEFAULT_FLAGS;
}

/** Mirrors `IS_PRODUCER_ACTIONABLE` / `IS_OPEN` in `audit-counters.ts`. */
const ACTIONABLE = {
  $or: [
    { $ne: ['$producerVisible', false] },
    { $eq: ['$reviewVerdict', 'fail'] },
  ],
};
const OPEN = {
  $and: [{ $eq: ['$isFailed', true] }, { $ne: ['$isResolved', true] }],
};

const BATCH = 1000;

async function flushBulk(collection, ops) {
  if (ops.length === 0) return 0;
  const result = await collection.bulkWrite(ops.splice(0), { ordered: false });
  return result.modifiedCount;
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const templates = db.collection('auditTemplates');
    const items = db.collection('dealAuditItems');
    const audits = db.collection('dealAudits');
    const deals = db.collection('deals');

    // 1. Templates.
    let templatesFlagged = 0;
    const templateOps = [];
    for await (const template of templates.find(
      { producerVisible: { $exists: false } },
      { projection: { name: 1 } },
    )) {
      const [producerVisible, requiresUpload] = flagsForName(template.name);
      templateOps.push({
        updateOne: {
          filter: { _id: template._id },
          update: { $set: { producerVisible, requiresUpload } },
        },
      });
      if (templateOps.length >= BATCH) {
        templatesFlagged += await flushBulk(templates, templateOps);
      }
    }
    templatesFlagged += await flushBulk(templates, templateOps);

    // Every template's flags, now that each has them, for step 2.
    const byTemplateId = new Map();
    for await (const template of templates.find(
      {},
      { projection: { producerVisible: 1, requiresUpload: 1 } },
    )) {
      byTemplateId.set(String(template._id), [
        template.producerVisible !== false,
        template.requiresUpload === true,
      ]);
    }

    // 2. Items.
    let itemsFlagged = 0;
    let viaTemplate = 0;
    const itemOps = [];
    for await (const item of items.find(
      { producerVisible: { $exists: false } },
      { projection: { templateId: 1, itemName: 1, title: 1 } },
    )) {
      const fromTemplate = item.templateId
        ? byTemplateId.get(String(item.templateId))
        : undefined;
      if (fromTemplate) viaTemplate += 1;
      const [producerVisible, requiresUpload] =
        fromTemplate || flagsForName(item.itemName || item.title);
      itemOps.push({
        updateOne: {
          filter: { _id: item._id },
          update: { $set: { producerVisible, requiresUpload } },
        },
      });
      if (itemOps.length >= BATCH) {
        itemsFlagged += await flushBulk(items, itemOps);
      }
    }
    itemsFlagged += await flushBulk(items, itemOps);

    const verdicts = await items.updateMany(
      { reviewVerdict: { $exists: false } },
      { $set: { reviewVerdict: null } },
    );

    // 3. Counters.
    let countersSet = 0;
    const counterOps = [];
    const rollups = items.aggregate(
      [
        { $match: { dealAuditId: { $ne: null } } },
        {
          $group: {
            _id: '$dealAuditId',
            producerItemCount: { $sum: { $cond: [ACTIONABLE, 1, 0] } },
            producerResolvedCount: {
              $sum: {
                $cond: [
                  { $and: [ACTIONABLE, { $eq: ['$isResolved', true] }] },
                  1,
                  0,
                ],
              },
            },
            producerOpenCount: {
              $sum: { $cond: [{ $and: [ACTIONABLE, OPEN] }, 1, 0] },
            },
          },
        },
      ],
      { allowDiskUse: true },
    );
    for await (const row of rollups) {
      counterOps.push({
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              producerItemCount: row.producerItemCount,
              producerResolvedCount: row.producerResolvedCount,
              producerOpenCount: row.producerOpenCount,
            },
          },
        },
      });
      if (counterOps.length >= BATCH) {
        countersSet += await flushBulk(audits, counterOps);
      }
    }
    countersSet += await flushBulk(audits, counterOps);

    // An audit with no items at all has none to count.
    const empty = await audits.updateMany(
      { producerItemCount: { $exists: false } },
      {
        $set: {
          producerItemCount: 0,
          producerResolvedCount: 0,
          producerOpenCount: 0,
        },
      },
    );

    // 4. Auto-submit.
    const stranded = await audits
      .find(
        { auditStatus: 'Not Submitted', producerItemCount: 0 },
        { projection: { _id: 1, dealId: 1 } },
      )
      .toArray();
    let autoSubmitted = 0;
    if (stranded.length > 0) {
      const now = new Date();
      const flipped = await audits.updateMany(
        {
          _id: { $in: stranded.map((audit) => audit._id) },
          auditStatus: 'Not Submitted',
        },
        {
          $set: { auditStatus: 'Pending', submittedAt: now, submittedById: null },
        },
      );
      autoSubmitted = flipped.modifiedCount;
      const dealIds = stranded
        .map((audit) => audit.dealId)
        .filter((id) => id != null);
      if (dealIds.length > 0) {
        await deals.updateMany(
          { _id: { $in: dealIds } },
          { $set: { dealAuditStatus: 'Pending' } },
        );
      }
    }

    console.log(
      `[audit-review] templates flagged: ${templatesFlagged}; ` +
        `items flagged: ${itemsFlagged} (${viaTemplate} via template); ` +
        `verdicts initialised: ${verdicts.modifiedCount}; ` +
        `producer counters set: ${countersSet} (+${empty.modifiedCount} empty); ` +
        `Not Submitted audits with no producer items submitted for review: ${autoSubmitted}`,
    );
  },

  /**
   * Removes the fields this added. **Does not** move the auto-submitted audits
   * back to `Not Submitted`: by the time anyone rolls back, a manager may
   * have reviewed them, and undoing a ruling is not this migration's to do.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    await db
      .collection('auditTemplates')
      .updateMany({}, { $unset: { producerVisible: '', requiresUpload: '' } });
    await db.collection('dealAuditItems').updateMany(
      {},
      { $unset: { producerVisible: '', requiresUpload: '', reviewVerdict: '' } },
    );
    await db.collection('dealAudits').updateMany(
      {},
      {
        $unset: {
          producerItemCount: '',
          producerResolvedCount: '',
          producerOpenCount: '',
        },
      },
    );
    console.log(
      '[audit-review] flags and producer counters removed; auto-submitted audits left as they are',
    );
  },
};
