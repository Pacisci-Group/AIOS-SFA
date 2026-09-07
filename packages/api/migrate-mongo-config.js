/**
 * migrate-mongo configuration.
 *
 * The single source of truth for BOTH entry points, so the two can never drift:
 *   - the CLI  — `npm run db:migrate*` (create / status / up / down by hand);
 *   - the API  — `src/database/run-migrations.ts`, which `require`s this exact
 *     file at startup rather than restating any of it.
 *
 * ⚠ Not to be confused with `src/migration/`. That is the **one-time
 * SmartSuite -> Mongo data import**, run by hand against an empty database
 * (see `scripts/migration/run-migration.sh`). This is the **ongoing, versioned
 * migration system**: every file in `migrations/` runs exactly once per
 * database, in filename order, recorded in `migrations_changelog`.
 *
 * Plain CommonJS on purpose. migrate-mongo's CLI `require`s this file directly,
 * so it can be neither TypeScript nor an import from `src/` — and the migration
 * files beside it are plain `.js` for the same reason. That also sidesteps the
 * trap `webpack.config.js` documents: migrations are never webpack entries, so
 * they cannot go missing from a deployed image the way every one-shot script
 * once did. `packages/api/Dockerfile` copies this file and `migrations/` as-is.
 */
const { existsSync } = require('fs');
const { resolve } = require('path');

/*
 * Mirrors `src/config/env.config.ts`, which this file cannot import (that is
 * TypeScript, compiled into the webpack bundle) — keep the two in step.
 *
 * A real environment variable always wins, because dotenv never overwrites one.
 * That is what makes this correct inside the container: compose injects
 * MONGODB_URI from /opt/sfa/.env and no repo `.env` exists there, so nothing
 * below has any effect.
 */
const ENV_CANDIDATES = [
  resolve(__dirname, '../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];
require('dotenv').config({
  path: ENV_CANDIDATES.find(existsSync) ?? ENV_CANDIDATES[0],
});

const MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://localhost:27017/sfa';

/**
 * The database named in the connection string's path, or `undefined`.
 *
 * Credentials cannot hide a `/` from this — MongoDB requires them to be
 * percent-encoded in the URI — so the first slash after the scheme is always
 * the one separating hosts from the database name.
 *
 * @param {string} uri
 * @returns {string | undefined}
 */
function databaseNameFromUri(uri) {
  const afterScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const firstSlash = afterScheme.indexOf('/');
  if (firstSlash === -1) {
    return undefined;
  }
  const name = afterScheme.slice(firstSlash + 1).split('?')[0];
  return name.length > 0 ? decodeURIComponent(name) : undefined;
}

/*
 * Passed to `client.db(databaseName)` explicitly rather than left undefined.
 * Undefined makes the driver fall back to its default database, `test` — so a
 * URI missing its path would quietly migrate the wrong database *and* write the
 * changelog there, leaving the real one untouched and looking un-migrated.
 * Fail loudly at config load instead, before anything connects.
 */
const databaseName = databaseNameFromUri(MONGODB_URI);
if (!databaseName) {
  throw new Error(
    `MONGODB_URI names no database ("${MONGODB_URI.replace(/\/\/[^@]+@/, '//****@')}"). ` +
      'Put one in the path — e.g. mongodb://localhost:27017/sfa — otherwise ' +
      'migrations and their changelog land in the driver default, "test".',
  );
}

module.exports = {
  mongodb: {
    url: MONGODB_URI,
    databaseName,
    options: {},
  },

  /*
   * Absolute, so it does not matter where the CLI is invoked from: `npm run -w
   * @sfa/api` sets cwd to this package, a bare `npx migrate-mongo` uses wherever
   * you happen to stand, and the container runs from /app. A relative path would
   * resolve against cwd in each case and find a different (or no) directory.
   */
  migrationsDir: resolve(__dirname, 'migrations'),

  /** Applied-migration ledger: one document per migration file, per database. */
  changelogCollectionName: 'migrations_changelog',

  /*
   * ── The lock ──────────────────────────────────────────────────────────────
   * migrate-mongo's own locking is DISABLED (`lockTtl: 0` switches it off) and
   * `src/database/run-migrations.ts` takes its own lock on this collection
   * instead. Two reasons the built-in one is not good enough to hold across an
   * API boot, where every replica starts at once:
   *
   *   1. It is racy. `lock.exist()` and `lock.activate()` are separate round
   *      trips with no atomicity between them, so two replicas starting
   *      together can both see "unlocked" and both migrate.
   *   2. It throws when it loses ("Could not migrate up, a lock is in place"),
   *      which would crash-loop the replica that lost rather than making it
   *      wait for the winner.
   *
   * The startup lock is a single atomic `insertOne` on a fixed `_id` — the
   * duplicate-key error *is* the mutual exclusion — and losers wait. The name
   * lives here so both sides agree on one collection.
   */
  lockCollectionName: 'migrations_lock',
  lockTtl: 0,

  migrationFileExtension: '.js',

  /*
   * Off. With `useFileHash` on, editing an applied migration makes it pending
   * again and it re-runs — which turns a typo fix in an old file into a
   * surprise write against production. Applied migrations are immutable here:
   * to change something that already ran, add a new migration.
   */
  useFileHash: false,

  moduleSystem: 'commonjs',
};
