import { BigQuery } from '@google-cloud/bigquery';
import type { Readable } from 'stream';
import { parseSourceDate } from '../../common/mailers/mailer-parse';

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
 * The ticker a row belongs to: an explicit `--assign-file` for its exact
 * `FileName` first, the name's leading letters otherwise.
 *
 * The assignment exists because the prefix rule skipped five real SFA files at
 * cutover — `April_P (3)`, `Copy_oP`, `QB-SplP (1)` and `2025-QP`, whose digits
 * yield no ticker at all. The agency owner confirmed each one by name, so that
 * is what the override matches on: the whole name, never a looser prefix.
 */
export function resolveRowTicker(
  fileName: unknown,
  assignments: ReadonlyMap<string, string>,
): string | null {
  if (typeof fileName === 'string') {
    const assigned = assignments.get(fileName.trim());
    if (assigned) return assigned;
  }
  return tickerFromFileName(fileName);
}

/**
 * Calendar year of a row's `quotedate`, for its implicit campaign. Null when
 * the row carries no readable date, and the campaign then falls into its
 * agency's "unknown" bucket rather than inventing a year.
 *
 * ⚠ Goes through `parseSourceDate`, the mapper's own reader. BigQuery ships
 * `quotedate` as a **STRING** column, so an Excel serial arrives as `"46123"`,
 * and `new Date("46123")` is a valid date in the year 46122. The cutover run
 * used that and filed 18 of its 38 campaigns under five-digit years, splitting
 * week 34 across three of them.
 */
export function campaignYear(quotedate: unknown): number | null {
  return parseSourceDate(quotedate)?.getUTCFullYear() ?? null;
}

/** Which rows to read. Everything is optional; nothing means the whole table. */
export interface MailerRowSelection {
  /** Exact `FileName`s, compared trimmed. */
  fileNames?: readonly string[];
  /** An ISO instant: rows whose `ingest_uploaded_at` is at or after it. */
  ingestedSince?: string;
  limit?: number;
  /** Newest `last_updated` first. See the ordering note below. */
  newestFirst?: boolean;
}

export interface MailerRowQuery {
  query: string;
  params?: Record<string, string | string[]>;
}

/**
 * The SQL {@link openMailerRowStream} runs, split out so its shape is testable
 * without a BigQuery client.
 *
 * `fileNames` and `ingestedSince` combine with **OR**: "these files, and
 * anything uploaded since". Both travel as query parameters. File names contain
 * spaces, parentheses and potentially quotes, and interpolating them would be
 * one apostrophe away from a broken or different query.
 */
export function buildMailerRowQuery(
  config: Pick<BigQueryMailerConfig, 'projectId' | 'datasetId' | 'tableId'>,
  selection: MailerRowSelection = {},
): MailerRowQuery {
  // The table name is interpolated because BigQuery cannot parameterise an
  // identifier; every part of it comes from env, never from user input.
  const table = `\`${config.projectId}.${config.datasetId}.${config.tableId}\``;

  const where: string[] = [];
  const params: Record<string, string | string[]> = {};
  if (selection.fileNames && selection.fileNames.length > 0) {
    where.push('TRIM(FileName) IN UNNEST(@fileNames)');
    params.fileNames = [...selection.fileNames];
  }
  if (selection.ingestedSince) {
    where.push('ingest_uploaded_at >= TIMESTAMP(@ingestedSince)');
    // BigQuery's canonical form, which it parses without ambiguity.
    params.ingestedSince = selection.ingestedSince
      .replace('T', ' ')
      .replace(/Z$/, '+00');
  }

  const filter = where.length > 0 ? ` WHERE ${where.join(' OR ')}` : '';
  const order = selection.newestFirst ? 'DESC' : 'ASC';
  const limit = selection.limit ? ` LIMIT ${Math.floor(selection.limit)}` : '';

  return {
    query: `SELECT * FROM ${table}${filter} ORDER BY last_updated ${order}${limit}`,
    ...(where.length > 0 ? { params } : {}),
  };
}

/**
 * Stream mailer rows out of BigQuery.
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
 * Duplicate control numbers collapse onto one document, and the **newest** row
 * must be the one that survives. An upsert keeps the row it writes *last*, so
 * the default is `last_updated` ascending. An add-only run keeps the row it
 * writes *first*, so it asks for `newestFirst`. `is_duplicate` is not
 * consulted: it is `false` on every row because it means *all columns
 * identical*, and a re-ingest always differs in ingest metadata. Carl confirmed
 * the duplicates are a testing artifact, so collapsing them is correct rather
 * than lossy.
 */
export function openMailerRowStream(
  config: BigQueryMailerConfig,
  selection: MailerRowSelection = {},
): Readable {
  const client = new BigQuery({
    projectId: config.projectId,
    credentials: config.credentials,
  });

  const { query, params } = buildMailerRowQuery(config, selection);
  return client.createQueryStream({
    query,
    ...(params ? { params } : {}),
    location: 'US',
  });
}
