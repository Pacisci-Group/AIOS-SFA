import { config as loadEnv } from 'dotenv';
import { carrierSlug, mailerControlNumberKey } from '@sfa/shared';
import { createConnection, mongo, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../config/env.config';
import {
  implicitCampaignDoc,
  implicitCampaignKey,
} from '../../common/mailers/implicit-campaign';
import { DEFAULT_MAILER_CARRIER } from '../../common/mailers/mailer-carrier';
import {
  MAILER_DEDUPE_INDEX_KEY,
  MAILER_DEDUPE_INDEX_NAME,
  MAILER_DEDUPE_INDEX_OPTIONS,
} from '../../mailers/schemas/mailer.schema';
import {
  LEAD_MAILER_CAMPAIGN_INDEX_KEY,
  LEAD_MAILER_CAMPAIGN_INDEX_OPTIONS,
  LEAD_MAILER_KEY_INDEX_KEY,
  LEAD_MAILER_KEY_INDEX_OPTIONS,
  LEAD_MAILER_UNIQUE_INDEX_KEY,
  LEAD_MAILER_UNIQUE_INDEX_NAME,
  LEAD_MAILER_UNIQUE_INDEX_OPTIONS,
} from '../../leads/schemas/lead.schema';

/**
 * One-off, re-runnable: move `mailers` from agency tenancy to campaign tenancy,
 * and backfill `Lead.mailer` (PAC-71).
 *
 * WHY THIS EXISTS
 * ---------------
 * `Mailer.agencyId` is gone. Every existing row — the BigQuery backfill, the old
 * Add Mailers uploads — needs a `campaignId`, a `visibleAgencyIds` and a
 * `carrierAgencyId`, and the dedupe index has to move from
 * `{agencyId, controlNumberKeys}` to `{controlNumberKeys}` alone. An index whose
 * *options or key* changed is never rebuilt by Mongoose (`autoIndex` only
 * creates missing ones), so this cannot be left to the app.
 *
 * ⚠ RUN ORDER IN PRODUCTION
 * -------------------------
 *   1. **Stop the API and the worker.**
 *   2. Run this script, from the new build.
 *   3. Deploy.
 *
 * Both halves matter. Old code's upsert filter (`{agencyId, controlNumberKeys}`)
 * would insert un-stamped rows while the script is running, and new code's
 * `autoIndex` would try to build the platform-wide unique index *before*
 * duplicates have been verified — which fails, leaving the collection with no
 * uniqueness at all.
 *
 * USAGE
 * -----
 *   npm run backfill:mailer-campaigns:dev -w @sfa/api -- --dry-run
 *   npm run backfill:mailer-campaigns:dev -w @sfa/api
 *   npm run backfill:mailer-campaigns:dev -w @sfa/api -- --merge-duplicates
 *
 * ⚠ Run it through the workspace, not the root alias: the root scripts swallow
 * everything after `--`, so `npm run api:backfill:… -- --dry-run` silently runs
 * without the flag.
 *
 * SAFETY
 * ------
 * - Every phase is idempotent. A second run reports all zeros.
 * - Duplicates are checked **before** any index is touched. Rebuilding a unique
 *   index over real duplicates fails, and failing after a drop would leave the
 *   collection unprotected. Duplicates abort the run (exit 1) with the list
 *   printed, unless `--merge-duplicates` is passed — which is deterministic but
 *   **destructive**: it keeps the newest row, unions `visibleAgencyIds` and
 *   repoints lead links.
 * - The new dedupe index is created **before** the old ones are dropped. The key
 *   patterns differ, so both coexist happily and there is no window in which
 *   uniqueness is unenforced — unlike the drop-then-create an options-only
 *   change would force.
 * - Index specs are **imported**, never restated. `createIndex` is idempotent
 *   only when the spec matches exactly, and a drifted copy here makes
 *   `autoIndex` throw `IndexOptionsConflict` at the next boot.
 * - Connects with a bare driver connection and no models on purpose: loading the
 *   schemas would trigger `autoIndex` and race this script for the very indexes
 *   it is creating.
 */

loadEnv({ path: ENV_FILE_PATH });

export interface BackfillOptions {
  dryRun: boolean;
  mergeDuplicates: boolean;
  carrierSlug: string;
}

export interface BackfillResult {
  campaignsCreated: number;
  mailersStamped: number;
  duplicateKeys: number;
  duplicatesMerged: number;
  indexesCreated: string[];
  indexesDropped: string[];
  agencyIdUnset: number;
  leadsLinked: number;
  leadsKeyOnly: number;
  leadsConflicted: number;
  /** Non-empty means the run stopped short and the caller should exit 1. */
  blockers: string[];
}

/** The four indexes agency tenancy left behind. Dropped once nothing reads them. */
const LEGACY_MAILER_INDEXES = [
  'agencyId_1_controlNumberKeys_1',
  'agencyId_1',
  'agencyId_1_campaign.campaignNumber_1',
  'agencyId_1_source.runId_1',
];

/** How many offending rows to print before truncating. */
const SAMPLE = 20;

interface MailerGroup {
  _id: {
    agencyId: string | null;
    weekNumber: number | null;
    year: number | null;
  };
  count: number;
  campaignNumber: string | null;
  fileName: string | null;
}

interface DuplicateGroup {
  _id: string;
  ids: Types.ObjectId[];
  count: number;
}

/** The projection the lead backfill reads off each candidate lead. */
interface LeadCandidate {
  _id: Types.ObjectId;
  quoteControlNumber: string;
  agencyId: string;
}

/** The projection `mergeDuplicates` reads off each contender. */
interface DuplicateCandidate {
  _id: Types.ObjectId;
  visibleAgencyIds?: string[] | null;
  controlNumberKeys?: string[];
  updatedAt?: Date;
  source?: { lastUpdatedAt?: Date };
}

export async function run(
  db: mongo.Db,
  options: BackfillOptions,
  log: (message: string) => void = console.log,
): Promise<BackfillResult> {
  const mailers = db.collection('mailers');
  const campaigns = db.collection('mailerCampaigns');
  const leads = db.collection('leads');

  const result: BackfillResult = {
    campaignsCreated: 0,
    mailersStamped: 0,
    duplicateKeys: 0,
    duplicatesMerged: 0,
    indexesCreated: [],
    indexesDropped: [],
    agencyIdUnset: 0,
    leadsLinked: 0,
    leadsKeyOnly: 0,
    leadsConflicted: 0,
    blockers: [],
  };

  // --- Phase 1: preconditions ---------------------------------------------
  // The carrier catalog is `seedCarriers`' to own. This script never creates a
  // carrier — a second writer would fork the catalog.
  const carrier = await db
    .collection('carriers')
    .findOne({ agencyId: null, slug: options.carrierSlug });
  if (!carrier) {
    throw new Error(
      `No global carrier with slug "${options.carrierSlug}". ` +
        'Run the core seed first (npm run api:seed:dev).',
    );
  }
  log(`Carrier: ${carrier.name as string} (${options.carrierSlug})`);

  const unstampedFilter = { campaignId: { $exists: false } };
  const unstamped = await mailers.countDocuments(unstampedFilter);
  log(`Mailers without a campaign: ${unstamped.toLocaleString()}`);

  // --- Phase 2: implicit campaigns ----------------------------------------
  // Grouped by `(agency, week, year)` — the only three things the old data
  // actually says about a campaign. `allowDiskUse` because this groups the whole
  // collection and production holds ~671k rows.
  const groups = (await mailers
    .aggregate(
      [
        { $match: unstampedFilter },
        {
          $group: {
            _id: {
              agencyId: '$agencyId',
              weekNumber: '$campaign.weekNumber',
              // Guarded rather than a bare `$year`: a row with no `quoteDate`
              // must fall into its agency's "unknown year" bucket, not abort
              // the aggregation on a type error.
              year: {
                $cond: [
                  { $eq: [{ $type: '$quoteDate' }, 'date'] },
                  { $year: '$quoteDate' },
                  null,
                ],
              },
            },
            count: { $sum: 1 },
            campaignNumber: { $first: '$campaign.campaignNumber' },
            fileName: { $first: '$campaign.fileName' },
          },
        },
        { $sort: { count: -1 } },
      ],
      { allowDiskUse: true },
    )
    .toArray()) as unknown as MailerGroup[];

  log(`Implicit campaigns to create: ${groups.length}`);

  for (const group of groups) {
    const agencyId = group._id.agencyId;
    if (!agencyId) {
      // A row with neither `agencyId` nor `campaignId` cannot be attributed and
      // must not be guessed at. Reported so somebody decides, never silently
      // parked in a catch-all campaign that would then be visible to whoever
      // owns it.
      result.blockers.push(
        `${group.count} mailer(s) carry no agencyId and no campaignId — nothing to attribute them to.`,
      );
      continue;
    }

    const key = {
      agencyId,
      weekNumber: group._id.weekNumber ?? null,
      year: group._id.year ?? null,
    };
    const migrationKey = implicitCampaignKey(key);

    if (options.dryRun) {
      result.campaignsCreated += 1;
      continue;
    }

    const agency = await db
      .collection('agencies')
      .findOne(
        { _id: new Types.ObjectId(agencyId) },
        { projection: { name: 1 } },
      );

    // `migrationKey` is pulled out of the `$setOnInsert` body and used as the
    // filter instead, so a re-run matches the existing campaign rather than
    // trying to set the field it is matching on.
    const { migrationKey: _, ...doc } = implicitCampaignDoc(key, {
      carrierId: carrier._id,
      agencyName: (agency?.name as string | undefined) ?? null,
      campaignNumber: group.campaignNumber,
      fileName: group.fileName,
      source: 'migration',
    });
    void _;

    const upserted = await campaigns.findOneAndUpdate(
      { migrationKey },
      {
        $setOnInsert: {
          ...doc,
          migrationKey,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    );
    const campaignId = upserted!._id.toString();
    result.campaignsCreated += 1;

    // --- Phase 3: stamp -----------------------------------------------------
    // A pipeline update so `carrierAgencyId` can be derived from the row's own
    // preserved `source.raw.agencyid` in one pass. `$$REMOVE` rather than an
    // empty string when the column was absent: `''` would index and read as a
    // code, and `$toUpper(null)` is `''`, which is exactly that trap.
    const stamped = await mailers.updateMany(
      {
        ...unstampedFilter,
        agencyId,
        // `$in: [null]` matches a missing field as well as an explicit null,
        // which is the whole "unknown week" group.
        ...(key.weekNumber === null
          ? { 'campaign.weekNumber': { $in: [null] } }
          : { 'campaign.weekNumber': key.weekNumber }),
      },
      [
        {
          $set: {
            __code: {
              $cond: [
                { $eq: [{ $type: '$source.raw.agencyid' }, 'string'] },
                { $toUpper: { $trim: { input: '$source.raw.agencyid' } } },
                '',
              ],
            },
            __year: {
              $cond: [
                { $eq: [{ $type: '$quoteDate' }, 'date'] },
                { $year: '$quoteDate' },
                null,
              ],
            },
          },
        },
        {
          $set: {
            campaignId: {
              // Guard the year inside the update as well as in the filter: two
              // groups for one agency and week differ only by year, and a filter
              // cannot express `$year` without an expression stage.
              $cond: [
                { $eq: [{ $ifNull: ['$__year', null] }, key.year] },
                campaignId,
                '$$REMOVE',
              ],
            },
            visibleAgencyIds: {
              $cond: [
                { $eq: [{ $ifNull: ['$__year', null] }, key.year] },
                [agencyId],
                '$$REMOVE',
              ],
            },
            carrierAgencyId: {
              $cond: [
                { $gt: [{ $strLenCP: '$__code' }, 0] },
                '$__code',
                '$$REMOVE',
              ],
            },
          },
        },
        { $unset: ['__code', '__year'] },
      ],
    );
    result.mailersStamped += stamped.modifiedCount;
  }

  if (!options.dryRun) {
    const remaining = await mailers.countDocuments(unstampedFilter);
    if (remaining > 0) {
      result.blockers.push(
        `${remaining} mailer(s) still carry no campaignId after stamping.`,
      );
    }
  }

  // --- Phase 4: duplicate check, BEFORE touching any index -----------------
  const duplicates = (await mailers
    .aggregate(
      [
        { $match: { controlNumberKeys: { $type: 'string' } } },
        { $unwind: '$controlNumberKeys' },
        {
          $group: {
            _id: '$controlNumberKeys',
            ids: { $addToSet: '$_id' },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ],
      { allowDiskUse: true },
    )
    .toArray()) as unknown as DuplicateGroup[];

  result.duplicateKeys = duplicates.length;

  if (duplicates.length > 0) {
    log(`\nDuplicate control-number keys: ${duplicates.length}`);
    for (const duplicate of duplicates.slice(0, SAMPLE)) {
      log(`  ${duplicate._id} ×${duplicate.count}`);
    }
    if (duplicates.length > SAMPLE) {
      log(`  … and ${duplicates.length - SAMPLE} more`);
    }

    if (!options.mergeDuplicates) {
      result.blockers.push(
        'Duplicate control-number keys exist across agencies. The platform-wide ' +
          'unique index cannot be built over them. Re-run with --merge-duplicates ' +
          'to keep the newest row of each set, union its visibility and repoint ' +
          'lead links.',
      );
      return result;
    }

    if (!options.dryRun) {
      result.duplicatesMerged = await mergeDuplicates(db, duplicates, log);
      const recheck = await mailers
        .aggregate([
          { $match: { controlNumberKeys: { $type: 'string' } } },
          { $unwind: '$controlNumberKeys' },
          { $group: { _id: '$controlNumberKeys', count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
          { $limit: 1 },
        ])
        .toArray();
      if (recheck.length > 0) {
        result.blockers.push(
          'Duplicates remain after --merge-duplicates. Not touching any index.',
        );
        return result;
      }
    }
  }

  if (options.dryRun) return result;

  // --- Phase 5: index swap -------------------------------------------------
  // Create first. The key patterns differ (`{controlNumberKeys}` versus
  // `{agencyId, controlNumberKeys}`), so both indexes coexist and there is never
  // a moment without a uniqueness constraint.
  await mailers.createIndex(MAILER_DEDUPE_INDEX_KEY, {
    name: MAILER_DEDUPE_INDEX_NAME,
    ...MAILER_DEDUPE_INDEX_OPTIONS,
  });
  result.indexesCreated.push(MAILER_DEDUPE_INDEX_NAME);
  await mailers.createIndex({ campaignId: 1, lastName: 1, firstName: 1 });
  await mailers.createIndex({ campaignId: 1, 'source.runId': 1 });

  const existing = await mailers.indexes();
  for (const name of LEGACY_MAILER_INDEXES) {
    if (!existing.some((index) => index.name === name)) continue;
    await mailers.dropIndex(name);
    result.indexesDropped.push(name);
  }

  // --- Phase 6: drop the field --------------------------------------------
  const unset = await mailers.updateMany(
    { agencyId: { $exists: true } },
    { $unset: { agencyId: '' } },
  );
  result.agencyIdUnset = unset.modifiedCount;

  // --- Phase 7: lead backfill ---------------------------------------------
  await backfillLeadLinks(db, result, log);

  await leads.createIndex(LEAD_MAILER_CAMPAIGN_INDEX_KEY, {
    ...LEAD_MAILER_CAMPAIGN_INDEX_OPTIONS,
  });
  await leads.createIndex(LEAD_MAILER_KEY_INDEX_KEY, {
    ...LEAD_MAILER_KEY_INDEX_OPTIONS,
  });
  // Unique last: it is the one that can fail, and failing after the cheap two
  // have been built is a better place to stop than the reverse.
  await leads.createIndex(LEAD_MAILER_UNIQUE_INDEX_KEY, {
    name: LEAD_MAILER_UNIQUE_INDEX_NAME,
    ...LEAD_MAILER_UNIQUE_INDEX_OPTIONS,
  });
  result.indexesCreated.push(LEAD_MAILER_UNIQUE_INDEX_NAME);

  return result;
}

/**
 * Collapse duplicate control-number keys onto one document.
 *
 * Deterministic: the survivor is the row with the newest
 * `source.lastUpdatedAt ?? updatedAt`, which is the same tiebreak the BigQuery
 * importer already documents. Visibility is **unioned** rather than taken from
 * the survivor — the duplicates existed precisely because two agencies each held
 * a copy, and dropping one agency's visibility would silently remove a mailer
 * their producers can look up today.
 *
 * ⚠ Destructive. Only reachable behind `--merge-duplicates`.
 */
async function mergeDuplicates(
  db: mongo.Db,
  duplicates: DuplicateGroup[],
  log: (message: string) => void,
): Promise<number> {
  const mailers = db.collection('mailers');
  const leads = db.collection('leads');
  let merged = 0;

  for (const duplicate of duplicates) {
    const docs = (await mailers
      .find({ _id: { $in: duplicate.ids } })
      .project({
        visibleAgencyIds: 1,
        controlNumberKeys: 1,
        updatedAt: 1,
        'source.lastUpdatedAt': 1,
      })
      .toArray()) as unknown as DuplicateCandidate[];
    if (docs.length < 2) continue;

    const ranked = [...docs].sort((a, b) => freshness(b) - freshness(a));
    const [survivor, ...losers] = ranked;

    // `null` is "visible to every agency" and absorbs everything else.
    const anyGlobal = docs.some((doc) => doc.visibleAgencyIds === null);
    const union = anyGlobal
      ? null
      : [...new Set(docs.flatMap((doc) => doc.visibleAgencyIds ?? []))];
    const keys = [
      ...new Set(docs.flatMap((doc) => doc.controlNumberKeys ?? [])),
    ];

    await mailers.updateOne(
      { _id: survivor._id },
      { $set: { visibleAgencyIds: union, controlNumberKeys: keys } },
    );

    const loserIds = losers.map((doc) => doc._id);
    await leads.updateMany(
      { 'mailer.mailerId': { $in: loserIds } },
      { $set: { 'mailer.mailerId': survivor._id } },
    );
    await mailers.deleteMany({ _id: { $in: loserIds } });

    merged += loserIds.length;
    log(`  merged ${duplicate._id}: kept ${survivor._id.toString()}`);
  }

  return merged;
}

function freshness(doc: DuplicateCandidate): number {
  const date = doc.source?.lastUpdatedAt ?? doc.updatedAt;
  return date ? new Date(date).getTime() : 0;
}

/**
 * Fill `Lead.mailer` from the control number leads already carry.
 *
 * Three passes, because "exactly one lead per mailer" is a property of the
 * **set**, not of any single lead:
 *
 * 1. Group every candidate lead by its normalized key.
 * 2. Resolve each key to a mailer, and group the leads by *that*.
 * 3. Link only the mailers exactly one lead claims.
 *
 * ⚠ Pass 2 is not redundant with pass 1, and skipping it is a real defect the
 * e2e caught: the long and short printed forms normalize to **different keys**
 * that resolve to the **same mailer** (the mailer holds both in
 * `controlNumberKeys`). Grouping by key alone therefore let two leads through
 * as "unique", and the unique index rejected the whole run with E11000.
 *
 * A mailer several leads claim is reported as a **conflict** and every one of
 * them keeps the key alone. Linking whichever the cursor happened to yield first
 * would put a campaign's attribution on a coin toss.
 *
 * `linkedBy` is null throughout: nobody made these links, a script did.
 */
async function backfillLeadLinks(
  db: mongo.Db,
  result: BackfillResult,
  log: (message: string) => void,
): Promise<void> {
  const leads = db.collection('leads');
  const mailers = db.collection('mailers');

  // --- Pass 1: group candidate leads by normalized key --------------------
  const byKey = new Map<string, LeadCandidate[]>();
  const cursor = leads
    .find({
      quoteControlNumber: { $type: 'string' },
      mailer: { $exists: false },
    })
    .project<LeadCandidate>({ quoteControlNumber: 1, agencyId: 1 });

  for await (const lead of cursor) {
    const key = mailerControlNumberKey(lead.quoteControlNumber);
    if (!key) continue;
    const bucket = byKey.get(key) ?? [];
    bucket.push(lead);
    byKey.set(key, bucket);
  }

  log(`\nLeads carrying a control number: ${byKey.size} distinct key(s)`);

  /** Mailers a lead outside this pass already owns. They are not up for grabs. */
  const alreadyOwned = new Set(
    (
      await leads
        .find({ 'mailer.mailerId': { $type: 'objectId' } })
        .project<{ mailer: { mailerId: Types.ObjectId } }>({
          'mailer.mailerId': 1,
        })
        .toArray()
    ).map((lead) => lead.mailer.mailerId.toString()),
  );

  const keyOnly: { lead: LeadCandidate; key: string }[] = [];
  const byMailer = new Map<
    string,
    { campaignId: string; claims: { lead: LeadCandidate; key: string }[] }
  >();

  // --- Pass 2: resolve each key to a mailer, and regroup -------------------
  for (const [key, claimants] of byKey) {
    if (claimants.length > 1) {
      log(`  conflict: ${key} claimed by ${claimants.length} leads — key only`);
      for (const lead of claimants) keyOnly.push({ lead, key });
      result.leadsConflicted += claimants.length;
      continue;
    }

    const [lead] = claimants;
    // The same visibility query the drawer runs. A mailer this lead's agency
    // cannot see is not this lead's mailer, however well the number matches.
    const mailer = await mailers.findOne(
      {
        controlNumberKeys: key,
        $or: [
          { visibleAgencyIds: { $type: 'null' } },
          { visibleAgencyIds: lead.agencyId },
        ],
      },
      { projection: { campaignId: 1 } },
    );

    if (!mailer || alreadyOwned.has(mailer._id.toString())) {
      keyOnly.push({ lead, key });
      continue;
    }

    const id = mailer._id.toString();
    const entry = byMailer.get(id) ?? {
      campaignId: mailer.campaignId as string,
      claims: [],
    };
    entry.claims.push({ lead, key });
    byMailer.set(id, entry);
  }

  // --- Pass 3: link the uncontested, report the rest -----------------------
  for (const [mailerId, entry] of byMailer) {
    if (entry.claims.length > 1) {
      log(
        `  conflict: mailer ${mailerId} claimed by ${entry.claims.length} leads — key only`,
      );
      keyOnly.push(...entry.claims);
      result.leadsConflicted += entry.claims.length;
      continue;
    }

    const [{ lead, key }] = entry.claims;
    await leads.updateOne(
      { _id: lead._id },
      {
        $set: {
          mailer: {
            mailerId: new Types.ObjectId(mailerId),
            campaignId: entry.campaignId,
            controlNumberKey: key,
            matchedBy: 'control_number',
            linkedAt: new Date(),
            linkedBy: null,
          },
        },
      },
    );
    result.leadsLinked += 1;
  }

  for (const { lead, key } of keyOnly) {
    await leads.updateOne(
      { _id: lead._id },
      {
        $set: {
          mailer: {
            mailerId: null,
            campaignId: null,
            controlNumberKey: key,
            linkedBy: null,
          },
        },
      },
    );
    result.leadsKeyOnly += 1;
  }
}

function parseOptions(argv: string[]): BackfillOptions {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string, fallback: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    dryRun: has('--dry-run'),
    mergeDuplicates: has('--merge-duplicates'),
    carrierSlug: value('--carrier-slug', carrierSlug(DEFAULT_MAILER_CARRIER)),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/sfa';
  console.log(`Connecting to ${uri.replace(/\/\/[^@]+@/, '//****@')}`);
  console.log(options.dryRun ? 'DRY RUN — nothing will be written.\n' : '\n');

  // A bare connection with no models, deliberately: loading the schemas would
  // trigger `autoIndex` and race this script for the very indexes it creates.
  const connection = createConnection(uri);
  await connection.asPromise();
  const db = connection.db;
  if (!db) throw new Error('No database handle on the connection');

  try {
    const result = await run(db, options);

    console.log('\nDone.');
    console.log(`  campaigns created  : ${result.campaignsCreated}`);
    console.log(`  mailers stamped    : ${result.mailersStamped}`);
    console.log(`  duplicate keys     : ${result.duplicateKeys}`);
    console.log(`  duplicates merged  : ${result.duplicatesMerged}`);
    console.log(
      `  indexes created    : ${result.indexesCreated.join(', ') || '—'}`,
    );
    console.log(
      `  indexes dropped    : ${result.indexesDropped.join(', ') || '—'}`,
    );
    console.log(`  agencyId unset     : ${result.agencyIdUnset}`);
    console.log(`  leads linked       : ${result.leadsLinked}`);
    console.log(`  leads key-only     : ${result.leadsKeyOnly}`);
    console.log(`  leads conflicted   : ${result.leadsConflicted}`);

    if (result.blockers.length > 0) {
      console.error('\nStopped short:');
      for (const blocker of result.blockers) console.error(`  ✗ ${blocker}`);
      process.exitCode = 1;
    }
  } finally {
    await connection.close();
  }
}

// `require.main` rather than a bare call: the e2e spec imports `run` directly,
// and an import must not connect to whatever `MONGODB_URI` happens to point at.
if (require.main === module) {
  main().catch((error) => {
    console.error('Mailer campaign backfill failed:', error);
    process.exit(1);
  });
}
