import { config as loadEnv } from 'dotenv';
import { createConnection } from 'mongoose';
import { ENV_FILE_PATH } from '../../config/env.config';
import { LEGACY_DEDUPE_INDEX_OPTIONS } from '../../common/schemas/tenant-record.schema';

/**
 * One-off, re-runnable rebuild of the `{ agencyId, legacySmartSuiteId }`
 * migration-dedupe index.
 *
 * WHY THIS EXISTS
 * ---------------
 * The index was originally declared `unique + sparse`. A *compound* sparse
 * index only skips a document when **every** indexed field is absent, and
 * `agencyId` is always present — so app-created records (which carry no legacy
 * id) all indexed as `(agencyId, null)` and the second one in an agency failed
 * with E11000. Creating a lead was broken for exactly that reason.
 *
 * `LEGACY_DEDUPE_INDEX_OPTIONS` was corrected to a `partialFilterExpression`,
 * but **Mongoose never rebuilds an index whose options changed** — `autoIndex`
 * only creates ones that are missing entirely. So collections that already
 * existed kept the broken definition, while collections created afterwards got
 * the correct one. That split is why the bug looked fixed and wasn't.
 *
 * That also means this cannot be left to the app: an options change needs an
 * explicit migration, and this script is the pattern to copy for the next one.
 *
 * WHICH COLLECTIONS
 * -----------------
 * Discovered by index name rather than hard-coded. Which collections are stale
 * depends on when each was first created, so dev, staging and production each
 * have a different set — a hard-coded list would silently under-fix somewhere.
 *
 * SAFETY
 * ------
 * - Idempotent: a collection already carrying a partial filter is skipped, so
 *   re-running (or wiring this into a deploy) is a no-op.
 * - Duplicates are checked *before* dropping anything. Rebuilding a unique
 *   index over real duplicates fails, and failing after the drop would leave
 *   the collection with no uniqueness at all.
 * - Connects with a bare Mongoose connection and no models on purpose: loading
 *   the schemas would trigger `autoIndex` and race this script for the very
 *   index it is rebuilding.
 *
 * Note: MongoDB rejects two indexes with the same key pattern differing only in
 * options, so drop-then-create is forced — there is a brief window where
 * uniqueness is not enforced. Irrelevant on dev; worth scheduling on prod.
 */

loadEnv({ path: ENV_FILE_PATH });

const INDEX_NAME = 'agencyId_1_legacySmartSuiteId_1';
const INDEX_KEY = { agencyId: 1, legacySmartSuiteId: 1 } as const;

/** The subset of an index spec this script reads. */
interface ExistingIndex {
  name?: string;
  partialFilterExpression?: Record<string, unknown>;
}

interface DuplicateKey {
  _id: { agencyId: string; legacySmartSuiteId: string };
  count: number;
}

async function run(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/sfa';
  console.log(`Connecting to ${uri.replace(/\/\/[^@]+@/, '//****@')}\n`);

  const connection = createConnection(uri);
  await connection.asPromise();
  const db = connection.db;
  if (!db) {
    throw new Error('No database handle on the connection');
  }

  const collections = await db.listCollections().toArray();
  let rebuilt = 0;
  let alreadyCorrect = 0;
  let blocked = 0;

  for (const { name } of collections) {
    const collection = db.collection(name);

    const indexes = (await collection.indexes()) as ExistingIndex[];
    const existing = indexes.find((index) => index.name === INDEX_NAME);
    if (!existing) {
      continue;
    }

    if (existing.partialFilterExpression) {
      alreadyCorrect += 1;
      continue;
    }

    // Only the migrated rows carry a string key, and only those are about to
    // fall under the unique constraint — so that is the set to check.
    const duplicates = (await collection
      .aggregate([
        { $match: { legacySmartSuiteId: { $type: 'string' } } },
        {
          $group: {
            _id: {
              agencyId: '$agencyId',
              legacySmartSuiteId: '$legacySmartSuiteId',
            },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray()) as DuplicateKey[];

    if (duplicates.length > 0) {
      blocked += 1;
      console.error(
        `✗ ${name}: ${duplicates.length} duplicate (agencyId, legacySmartSuiteId) pair(s) — left untouched`,
      );
      for (const duplicate of duplicates.slice(0, 5)) {
        console.error(
          `    agencyId=${duplicate._id.agencyId} legacySmartSuiteId=${duplicate._id.legacySmartSuiteId} ×${duplicate.count}`,
        );
      }
      if (duplicates.length > 5) {
        console.error(`    …and ${duplicates.length - 5} more`);
      }
      continue;
    }

    await collection.dropIndex(INDEX_NAME);
    await collection.createIndex(INDEX_KEY, {
      name: INDEX_NAME,
      ...LEGACY_DEDUPE_INDEX_OPTIONS,
    });
    rebuilt += 1;
    console.log(`✓ ${name}: rebuilt as partial`);
  }

  await connection.close();

  console.log(
    `\nDone. rebuilt=${rebuilt} already-correct=${alreadyCorrect} blocked=${blocked}`,
  );

  if (blocked > 0) {
    console.error(
      '\nSome collections were skipped because they hold genuine duplicate ' +
        'legacy ids. Resolve those rows, then re-run.',
    );
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error('Index rebuild failed:', error);
  process.exit(1);
});
