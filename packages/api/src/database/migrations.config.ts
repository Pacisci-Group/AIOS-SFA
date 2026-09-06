import { existsSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import type { config as migrateMongoConfig } from 'migrate-mongo';

/**
 * Loads `packages/api/migrate-mongo-config.js` — the one place migration
 * settings are written down, shared with the `migrate-mongo` CLI.
 *
 * ⚠ `src/database/` is the **versioned migration system** (files in
 * `packages/api/migrations/`, each applied once per database). `src/migration/`
 * is something else entirely: the one-time SmartSuite -> Mongo **data import**.
 */

/**
 * `lockCollectionName` is optional to migrate-mongo but required to us — the
 * startup lock in `run-migrations.ts` is keyed on it, and a config without it
 * would silently leave concurrent boots unguarded.
 */
export type MigrationConfig = migrateMongoConfig.Config & {
  lockCollectionName: string;
};

const CONFIG_FILE_NAME = 'migrate-mongo-config.js';

/**
 * Where the config file might be, most specific first.
 *
 * Same `existsSync` probe as `src/config/env.config.ts`, and for the same
 * reason: this code runs from four different places — the webpack bundle
 * (`dist/main.js`), ts-node against `src/`, an `npm run -w @sfa/api` with cwd at
 * the repo root, and the container with cwd at `/app` — and a single hard-coded
 * relative path is wrong in at least two of them. Probing costs one stat and
 * removes the whole class of "works locally, MODULE_NOT_FOUND on the server".
 */
const CONFIG_CANDIDATES = [
  // Bundled: __dirname is <pkg>/dist.
  resolve(__dirname, '..', CONFIG_FILE_NAME),
  // Unbundled / ts-node: __dirname is <pkg>/src/database.
  resolve(__dirname, '../..', CONFIG_FILE_NAME),
  // cwd at the repo root.
  resolve(process.cwd(), 'packages/api', CONFIG_FILE_NAME),
  // cwd inside the package.
  resolve(process.cwd(), CONFIG_FILE_NAME),
];

export function findMigrationConfigPath(): string | undefined {
  return CONFIG_CANDIDATES.find(existsSync);
}

/**
 * Reads the config, throwing with the paths tried if it is missing.
 *
 * Missing almost always means the deployed image is stale: the runner stage of
 * `packages/api/Dockerfile` copies this file and `migrations/` explicitly, so an
 * image built before that line existed has neither.
 */
export function loadMigrationConfig(): MigrationConfig {
  const configPath = findMigrationConfigPath();
  if (!configPath) {
    throw new Error(
      `Could not find ${CONFIG_FILE_NAME}. Looked in:\n` +
        CONFIG_CANDIDATES.map((path) => `  - ${path}`).join('\n') +
        '\nIf this is a deployed container, the image predates the Dockerfile ' +
        'line that copies the migration config and `migrations/` — rebuild it.',
    );
  }

  /*
   * `createRequire`, not a bare `require`: the path is only known at runtime,
   * and webpack rewrites `require(<expression>)` into a context module — it
   * would try to bundle every `.js` under the resolved directory and warn about
   * a critical dependency. A require function built at runtime is opaque to it,
   * so the file is read from disk exactly as the CLI reads it.
   */
  const config = createRequire(__filename)(configPath) as MigrationConfig;

  if (!config.lockCollectionName) {
    throw new Error(
      `${configPath} sets no lockCollectionName; the startup migration lock ` +
        'needs one to guard concurrent boots.',
    );
  }
  return config;
}
