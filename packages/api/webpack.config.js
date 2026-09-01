const path = require('path');

/**
 * Dev + prod: bundle @sfa/shared from TypeScript source; leave node_modules external.
 *
 * Every entry below is a way to start the ONE image. The runner stage of
 * `packages/api/Dockerfile` copies `dist` and never `src`, so a script that is
 * not an entry here simply does not exist in a deployed environment — its
 * `node dist/...` npm script fails with MODULE_NOT_FOUND. That is how the whole
 * operational toolchain came to be unrunnable on a server while working fine
 * locally under ts-node.
 *
 * Keep this list and the `scripts` block of `package.json` in step: every
 * compiled script there needs an entry here, and nothing here should outlive
 * the script that runs it.
 *
 * Long-running services:
 *   dist/main.js       the HTTP API (default CMD)
 *   dist/worker.js     the standalone worker — same image, different CMD, used
 *                      when WORKER_INLINE=false splits async work into its own
 *                      container. Built unconditionally so the split path is
 *                      always compiled and type-checked, never bit-rotting
 *                      until the day it is needed.
 *
 * One-shot scripts (`docker compose run --rm api node dist/<x>.js`):
 *   dist/seed/seed.js                              core seed — super admin,
 *                                                  empty tenant scaffold, roles
 *                                                  and the agency owner. Safe in
 *                                                  every environment; also the
 *                                                  compose start command.
 *   dist/migration/migrate.js                      SmartSuite -> Mongo import.
 *                                                  Needs SMARTSUITE_* creds,
 *                                                  which the deploy workflow does
 *                                                  NOT write to /opt/sfa/.env —
 *                                                  pass them on the one command
 *                                                  that needs them.
 *   dist/migration/mailers/import-bigquery-mailers.js
 *                                                  BigQuery mailer backfill.
 *                                                  Needs BQ_* + GCP creds.
 *
 * Occasional operations (not part of a bring-up):
 *   dist/seed/sync-role-templates.js               push a role-template change
 *                                                  out to already-provisioned
 *                                                  tenants. A fresh database
 *                                                  gets this from the seed.
 *
 *   dist/seed/demo/demo-seed.js                    synthetic demo agency. Built
 *                                                  so the script is not a trap on
 *                                                  dev/staging, but it writes ~500
 *                                                  fake CRM records — never run it
 *                                                  against production.
 */
const ONE_SHOT_ENTRIES = {
  'seed/seed': 'src/seed/seed.ts',
  'seed/demo/demo-seed': 'src/seed/demo/demo-seed.ts',
  'seed/sync-role-templates': 'src/seed/sync-role-templates.ts',
  'migration/migrate': 'src/migration/migrate.ts',
  'migration/mailers/import-bigquery-mailers':
    'src/migration/mailers/import-bigquery-mailers.ts',
};

module.exports = (options) => ({
  ...options,
  entry: {
    main: options.entry,
    worker: path.resolve(__dirname, 'src/worker.ts'),
    ...Object.fromEntries(
      Object.entries(ONE_SHOT_ENTRIES).map(([name, source]) => [
        name,
        path.resolve(__dirname, source),
      ]),
    ),
  },
  output: {
    ...options.output,
    filename: '[name].js',
  },
  externals: [
    ...(Array.isArray(options.externals) ? options.externals : []),
    ({ request }, callback) => {
      if (!request) {
        return callback();
      }
      if (request === '@sfa/shared' || request.startsWith('@sfa/shared/')) {
        return callback();
      }
      if (!request.startsWith('.') && !path.isAbsolute(request)) {
        return callback(null, `commonjs ${request}`);
      }
      callback();
    },
  ],
  resolve: {
    ...options.resolve,
    alias: {
      ...(options.resolve?.alias ?? {}),
      '@sfa/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
