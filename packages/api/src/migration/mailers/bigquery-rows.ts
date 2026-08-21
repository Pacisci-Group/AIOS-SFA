import { BigQuery } from '@google-cloud/bigquery';
import type { Readable } from 'stream';

/** Env this importer reads. Kept in one place so a missing one says so early. */
export interface BigQueryMailerConfig {
  projectId: string;
  datasetId: string;
  tableId: string;
  credentials: Record<string, unknown>;
}

/**
 * Read the BigQuery config, failing loudly on anything missing.
 *
 * ⚠ These variables are **new to this repo** (PAC-73). The legacy app reads a
 * similar set, but it points `BQ_MAILERS_VIEW_ID` at a *view*; this importer
 * reads the **base table** — see {@link openMailerRowStream}.
 */
export function readBigQueryConfig(
  env: NodeJS.ProcessEnv = process.env,
): BigQueryMailerConfig {
  const projectId = required(env, 'BQ_PROJECT_ID');
  const datasetId = required(env, 'BQ_DATASET_ID');
  // Defaulted, because there is exactly one right answer and getting it wrong
  // silently imports a filtered subset. See the note below.
  const tableId = env.BQ_MAILERS_TABLE_ID ?? 'Mailer_Test_Alteryx';
  const raw = required(env, 'GOOGLE_APPLICATION_CREDENTIALS_JSON');

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON. It must be the ' +
        'service-account key file contents, on one line.',
    );
  }

  return { projectId, datasetId, tableId, credentials };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. The mailer backfill ` +
        'needs GCP credentials; see .env.example.',
    );
  }
  return value;
}

/**
 * `SFA-20P` -> `SFA`. The leading letters of the pipeline's `FileName`.
 *
 * This is the only link between a BigQuery row and a tenant — nothing in that
 * table carries an agency reference we own. Returning `null` rather than a
 * best guess is deliberate: the caller skips and counts the row, and a re-run
 * picks it up once the `Agency` exists.
 *
 * Lives here rather than in the CLI entry point so it is importable by a test.
 * That entry point calls `main()` at module scope, as every script in
 * `src/migration/` and `src/seed/` does, so importing it *runs* it.
 */
export function tickerFromFileName(fileName: unknown): string | null {
  if (typeof fileName !== 'string') return null;
  const match = /^([A-Za-z]+)/.exec(fileName.trim());
  return match ? match[1].toUpperCase() : null;
}

/**
 * Stream every mailer row out of BigQuery.
 *
 * ## The base table, not a view
 *
 * `Mailer_Test_Alteryx` is the only real object. `_Parallel`, `_Current` and
 * `_Enriched` are views — `_Parallel` exists so users would not touch the base
 * table, and legacy pointed at it for that reason, not because it was
 * canonical. Importing from a view risks silently taking whatever subset or
 * transform the view happens to apply.
 *
 * ## Streaming, not `query()`
 *
 * 671,339 rows will not fit in one in-memory result set, and the point of the
 * shared engine is that it consumes an async iterable either way.
 *
 * ## Ordering
 *
 * By `last_updated` ascending, so that when the ~30,991 duplicate control
 * numbers collapse onto one document, the **newest** row is the one that lands
 * last and therefore wins. `is_duplicate` is not consulted: it is `false` on
 * every row because it means *all columns identical*, and a re-ingest always
 * differs in ingest metadata. Carl confirmed the duplicates are a testing
 * artifact, so collapsing them is correct rather than lossy.
 */
export function openMailerRowStream(
  config: BigQueryMailerConfig,
  options: { limit?: number } = {},
): Readable {
  const client = new BigQuery({
    projectId: config.projectId,
    credentials: config.credentials,
  });

  const table = `\`${config.projectId}.${config.datasetId}.${config.tableId}\``;
  const limit = options.limit ? ` LIMIT ${Math.floor(options.limit)}` : '';

  // The table name is interpolated because BigQuery cannot parameterise an
  // identifier; every part of it comes from env, never from user input.
  return client.createQueryStream({
    query: `SELECT * FROM ${table} ORDER BY last_updated ASC${limit}`,
    location: 'US',
  });
}
