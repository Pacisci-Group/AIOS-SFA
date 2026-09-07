import { Logger } from '@nestjs/common';
import { hostname } from 'os';
import { mongo } from 'mongoose';
import type { MigrationStatus } from 'migrate-mongo';
import { loadMigrationConfig } from './migrations.config';

/**
 * Applies every pending migration in `packages/api/migrations/`, once, before
 * the API serves anything.
 *
 * Called from `main.ts` *before* `NestFactory.create()` — see the comment there
 * for why the ordering is load-bearing.
 *
 * The driver types come through Mongoose (`mongo.Db`) rather than by importing
 * `mongodb`, which is a transitive dependency here and not a declared one —
 * same reasoning as `common/filters/mongo-duplicate-key.filter.ts`.
 */

/** Mongo's duplicate-key error code — the signal that we lost the lock race. */
const DUPLICATE_KEY = 11000;

/** Single fixed `_id`, so `insertOne` is the mutual exclusion. */
const LOCK_ID = 'migrations';

/**
 * How often the holder refreshes `acquiredAt` while it migrates.
 *
 * The heartbeat is what makes "stale" mean *dead* rather than *slow*. Without
 * it, staleness could only be judged from when the lock was taken, so the
 * timeout would have to exceed the longest migration anyone might ever write —
 * and a backfill that ran past it would have a second replica reap a live lock
 * and start migrating alongside the first. With it, a migration may take as long
 * as it likes and still hold the lock unambiguously.
 */
const LOCK_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * No heartbeat for this long means the holder died mid-migration — ten missed
 * beats, so a slow write or a brief network stall cannot be mistaken for death.
 * Without reaping at all, one OOM kill would block every future boot until
 * someone dropped the collection by hand.
 */
const STALE_LOCK_MS = 5 * 60_000;

const LOCK_POLL_INTERVAL_MS = 1_000;
/** How often a waiting replica says it is still waiting, and on whom. */
const LOCK_WAIT_REPORT_INTERVAL_MS = 30_000;
/**
 * Acquire attempts before giving up. More than one so that a replica waiting on
 * a holder that dies can take the work over; bounded so that a genuine
 * pathology surfaces as a failed boot instead of an infinite wait.
 */
const MAX_LOCK_ATTEMPTS = 3;

interface MigrationLock {
  _id: string;
  holder: string;
  acquiredAt: Date;
}

/** The subset of migrate-mongo's surface this module uses. */
interface MigrateMongoApi {
  config: { set(config: unknown): void };
  database: {
    connect(): Promise<{ db: mongo.Db; client: mongo.MongoClient }>;
  };
  status(db: mongo.Db): Promise<MigrationStatus[]>;
  up(db: mongo.Db, client: mongo.MongoClient): Promise<string[]>;
}

/**
 * migrate-mongo 14 is ESM-only, and this package compiles to CommonJS.
 *
 * Its CommonJS wrapper (`lib/migrate-mongo.cjs`, what `require` resolves to) is
 * a **Proxy whose every property is a Promise** of the real export. So `mm.up`
 * is a Promise, not a function, and a plain `import { up } from 'migrate-mongo'`
 * type-checks perfectly and then fails at runtime with "up is not a function".
 *
 * Awaiting each member unwraps that. It is also a no-op if this ever resolves to
 * the real ESM module instead — a function is not a thenable, so `await fn` is
 * `fn` — which is why the indirection is safe to leave in place across upgrades.
 */
async function loadMigrateMongo(): Promise<MigrateMongoApi> {
  /*
   * A literal `require` so webpack keeps it external and emits the same call
   * (`webpack.config.js` externalises every bare specifier). A static `import`
   * would be rewritten by esModuleInterop into a `.default` lookup on that
   * Proxy, which returns yet another Promise and loses the named exports.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require('migrate-mongo') as Record<string, unknown>;
  const [config, database, status, up] = await Promise.all([
    loaded.config,
    loaded.database,
    loaded.status,
    loaded.up,
  ]);
  return { config, database, status, up } as MigrateMongoApi;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function pendingMigrations(
  migrateMongo: MigrateMongoApi,
  db: mongo.Db,
): Promise<string[]> {
  const items = await migrateMongo.status(db);
  return items
    .filter((item) => item.appliedAt === 'PENDING')
    .map((item) => item.fileName);
}

/**
 * Takes the lock, or reports that someone else holds it.
 *
 * `insertOne` on a fixed `_id` is the whole mechanism: the unique index on `_id`
 * exists on every collection, so exactly one concurrent caller succeeds and the
 * rest get E11000. There is no read-then-write window to lose.
 */
async function acquireLock(
  locks: mongo.Collection<MigrationLock>,
  holder: string,
  logger: Logger,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  const reaped = await locks.deleteMany({ acquiredAt: { $lt: cutoff } });
  if (reaped.deletedCount > 0) {
    logger.warn(
      `Cleared ${reaped.deletedCount} migration lock(s) older than ` +
        `${STALE_LOCK_MS / 60_000} minutes — a previous run was killed ` +
        'mid-migration. Check that the database is in the state you expect.',
    );
  }

  try {
    await locks.insertOne({ _id: LOCK_ID, holder, acquiredAt: new Date() });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * Refreshes the lock on an interval, so the holder is visibly alive for as long
 * as its migration runs. `unref` so a stray timer can never keep the process up.
 */
function startHeartbeat(
  locks: mongo.Collection<MigrationLock>,
  logger: Logger,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void locks
      .updateOne({ _id: LOCK_ID }, { $set: { acquiredAt: new Date() } })
      .catch((error: Error) =>
        // Not fatal on its own — the migration is still running and still holds
        // the lock. It only matters if it keeps failing for STALE_LOCK_MS, at
        // which point another replica is entitled to take over.
        logger.warn(`Could not refresh the migration lock: ${error.message}`),
      );
  }, LOCK_HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return timer;
}

/**
 * Waits for the holder either to release the lock or to stop heartbeating.
 *
 * Deliberately has no overall deadline. A holder that is alive should be waited
 * on however long its migration takes; one that is dead is detected by its
 * heartbeat going stale, which is a much better signal than any fixed timeout —
 * and `MAX_LOCK_ATTEMPTS` in the caller is what bounds the whole thing.
 */
async function waitForHolder(
  locks: mongo.Collection<MigrationLock>,
  logger: Logger,
): Promise<'released' | 'holder-died'> {
  const startedAt = Date.now();
  let nextReportAt = startedAt + LOCK_WAIT_REPORT_INTERVAL_MS;

  for (;;) {
    await sleep(LOCK_POLL_INTERVAL_MS);
    const held = await locks.findOne({ _id: LOCK_ID });
    if (!held) {
      return 'released';
    }

    if (Date.now() - held.acquiredAt.getTime() > STALE_LOCK_MS) {
      logger.warn(
        `${held.holder} stopped refreshing the migration lock ` +
          `(last seen ${held.acquiredAt.toISOString()}); taking over.`,
      );
      return 'holder-died';
    }

    // A silent multi-minute pause during a deploy is indistinguishable from a
    // hang, so say who we are waiting on rather than nothing at all.
    if (Date.now() >= nextReportAt) {
      logger.log(
        `Still waiting on migrations held by ${held.holder} ` +
          `(${Math.round((Date.now() - startedAt) / 1000)}s).`,
      );
      nextReportAt = Date.now() + LOCK_WAIT_REPORT_INTERVAL_MS;
    }
  }
}

/**
 * Runs pending migrations, or waits for whichever instance is running them.
 *
 * Throws on any failure. That is deliberate: the caller must not fall through to
 * serving requests against a database that is half migrated.
 */
export async function runPendingMigrations(): Promise<void> {
  const logger = new Logger('Migrations');
  const config = loadMigrationConfig();
  const migrateMongo = await loadMigrateMongo();
  migrateMongo.config.set(config);

  const { db, client } = await migrateMongo.database.connect();
  try {
    /*
     * Check before locking. The overwhelmingly common case is "nothing to do",
     * and it should cost one read and no writes — otherwise every replica of
     * every boot contends on a lock document to discover there is no work.
     */
    const pending = await pendingMigrations(migrateMongo, db);
    if (pending.length === 0) {
      logger.log(`Database "${db.databaseName}" is up to date.`);
      return;
    }
    logger.log(
      `${pending.length} pending migration(s) on "${db.databaseName}": ` +
        pending.join(', '),
    );

    const locks = db.collection<MigrationLock>(config.lockCollectionName);
    const holder = `${hostname()}:${process.pid}`;

    for (let attempt = 1; attempt <= MAX_LOCK_ATTEMPTS; attempt++) {
      if (await acquireLock(locks, holder, logger)) {
        const heartbeat = startHeartbeat(locks, logger);
        try {
          const applied = await migrateMongo.up(db, client);
          for (const fileName of applied) {
            logger.log(`  applied ${fileName}`);
          }
          logger.log(`Applied ${applied.length} migration(s).`);
          return;
        } finally {
          // `finally`, so a failure releases the lock and the error is what
          // surfaces. Holding it would additionally make every other replica
          // wait out STALE_LOCK_MS before reporting the same problem.
          clearInterval(heartbeat);
          await locks.deleteOne({ _id: LOCK_ID });
        }
      }

      logger.log('Another instance holds the migration lock; waiting for it.');
      if ((await waitForHolder(locks, logger)) === 'holder-died') {
        // Its lock has already been reaped, or will be by the next
        // `acquireLock`. Go round again and do the work ourselves.
        continue;
      }

      /*
       * It released the lock — but releasing says nothing about whether it
       * *succeeded*, since a migration that throws releases too. Re-check rather
       * than assume, so one failed migration stops every replica instead of only
       * the one that ran it.
       */
      const stillPending = await pendingMigrations(migrateMongo, db);
      if (stillPending.length > 0) {
        throw new Error(
          'The instance holding the migration lock finished without applying ' +
            `${stillPending.join(', ')}. Refusing to start against a ` +
            "half-migrated database — check that instance's logs.",
        );
      }
      logger.log('Migrations were applied by another instance.');
      return;
    }

    throw new Error(
      `Could not obtain the migration lock after ${MAX_LOCK_ATTEMPTS} ` +
        'attempts. Every holder died mid-migration, which points at something ' +
        'systematic — check the logs of the instances that took it, and the ' +
        `"${config.lockCollectionName}" collection.`,
    );
  } finally {
    // This connection exists only to migrate. The app opens its own through
    // Mongoose afterwards.
    await client.close();
  }
}
