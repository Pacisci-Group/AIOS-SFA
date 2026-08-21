import type {
  MailerImportCounts,
  MailerImportDetected,
  MailerImportRejection,
} from '@sfa/shared';
import { MAILER_IMPORT_REJECTION_SAMPLE_SIZE } from '@sfa/shared';
import {
  detectFromRow,
  displayControlNumber,
  mapMailerRow,
  type MailerMapContext,
  type RawMailerRow,
} from './mailer-row.mapper';

/**
 * The import engine shared by the RTP upload and the BigQuery backfill (PAC-73).
 *
 * ## Why this is a plain function and not an `@Injectable`
 *
 * The upload path runs inside `src/worker/`, which the eslint boundary in
 * `packages/api/eslint.config.mjs` forbids from importing a feature service —
 * that would drag a whole module graph across a boundary the worker exists to
 * keep clean. A dependency-free function taking its collaborators as arguments
 * is importable from the worker, from an offline CLI, and from PAC-71's
 * campaign flow when it arrives, with no module wiring at any of them.
 *
 * ## One normalizer, two sources
 *
 * The two callers differ **only** in how rows are read: a CSV stream from
 * object storage, or a BigQuery query stream. Everything past that — header
 * normalization, coercion, the dedupe key, the upsert — is this file. Two
 * independently written mappers over near-identical data is how the sources
 * drift into producing different documents for the same mailer.
 */

/** How many upserts go in one `bulkWrite`. */
const DEFAULT_BATCH_SIZE = 1_000;

/** One upsert, in the shape `Model.bulkWrite` takes. */
interface MailerUpsertOperation {
  updateOne: {
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
    upsert: boolean;
  };
}

/**
 * The only thing this engine needs from a Mongoose model.
 *
 * Structural rather than `Model<Mailer>` for two reasons: it keeps `common/`
 * from importing a feature directory's schema (the wrong direction), and it
 * dodges Mongoose's `bulkWrite` generics, which do not accept a `Model<unknown>`
 * and would otherwise force a cast at every call site. A real `Model` satisfies
 * this as-is, and so does a fake in a test.
 */
export interface MailerUpsertTarget {
  bulkWrite(
    writes: MailerUpsertOperation[],
    options: { ordered: boolean },
  ): Promise<{ upsertedCount?: number; modifiedCount?: number }>;
}

export interface MailerImportOptions {
  batchSize?: number;
  /**
   * Parse and count without writing.
   *
   * This is what the preview runs: the operator sees the row count, what the
   * file says about itself, and the rejections **before** anything is written.
   */
  dryRun?: boolean;
}

export interface MailerImportResult {
  counts: MailerImportCounts;
  /** A capped sample. `counts.skipped` is the authoritative total. */
  rejections: MailerImportRejection[];
  /** What the file said about itself, from the first data row. */
  detected: MailerImportDetected | null;
  /**
   * Columns that were supposed to be single-valued across the file but were
   * not.
   *
   * "One file = one campaign, one agency, one product" is an observation about
   * real files, not a guarantee the format makes. If it stops holding, the
   * per-upload agency choice silently mis-files whichever rows disagree — so it
   * is verified rather than assumed, and reported rather than enforced (a
   * second value is a reason to look at the file, not to refuse it).
   */
  inconsistentColumns: string[];
}

/** Columns asserted to be constant across a file. See `inconsistentColumns`. */
const SINGLE_VALUED_COLUMNS = [
  'agencyid',
  'agencyname',
  'campaignnumber',
  'filename',
  'quotedate',
] as const;

/**
 * Read every row, map it, and upsert in batches.
 *
 * Idempotent: the upsert filter is the dedupe key, so re-running over the same
 * source updates in place and creates nothing new. That property is what makes
 * a retried worker job safe, and what lets the backfill be re-runnable rather
 * than one-shot.
 */
export async function importMailerRows(
  rows: AsyncIterable<Record<string, unknown>>,
  ctx: MailerMapContext,
  deps: { model: MailerUpsertTarget },
  options: MailerImportOptions = {},
): Promise<MailerImportResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const dryRun = options.dryRun ?? false;

  const counts: MailerImportCounts = {
    read: 0,
    mapped: 0,
    created: 0,
    updated: 0,
    skipped: 0,
  };
  const rejections: MailerImportRejection[] = [];
  let detected: MailerImportDetected | null = null;
  const seenValues = new Map<string, Set<string>>();

  let batch: MailerUpsertOperation[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    if (!dryRun) {
      await writeBatch(deps.model, batch, counts, rejections);
    }
    batch = [];
  };

  for await (const raw of rows) {
    counts.read += 1;
    const row = raw as RawMailerRow;

    if (detected === null) {
      detected = detectFromRow(row);
    }
    trackSingleValued(row, seenValues);

    const result = mapMailerRow(row, ctx);
    if (!result.ok) {
      counts.skipped += 1;
      pushRejection(rejections, {
        row: counts.read,
        controlNumber: result.controlNumber,
        reason: result.reason,
      });
      continue;
    }

    counts.mapped += 1;
    const { primaryKey, keys, doc } = result.mapped;
    batch.push({
      updateOne: {
        filter: { agencyId: ctx.agencyId, controlNumberKeys: primaryKey },
        update: {
          $set: doc,
          // Set on insert only: the array is the unique index's key, and
          // rewriting it on every run would churn the index for no gain.
          $setOnInsert: { controlNumberKeys: keys },
        },
        upsert: true,
      },
    });

    if (batch.length >= batchSize) {
      await flush();
    }
  }

  await flush();

  return {
    counts,
    rejections,
    detected,
    inconsistentColumns: [...seenValues.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([column]) => column),
  };
}

/**
 * Write one batch, folding write errors into the rejection list.
 *
 * `ordered: false` so one bad row does not abort the rest of the batch, and the
 * `MongoBulkWriteError` is **caught rather than thrown**: a duplicate-key
 * collision on the multikey index is a per-row problem (two source rows sharing
 * a 12-hex short code is improbable across ~640k documents but not impossible)
 * and must degrade to one reported row, not a failed run of 671,339.
 */
async function writeBatch(
  model: MailerUpsertTarget,
  batch: MailerUpsertOperation[],
  counts: MailerImportCounts,
  rejections: MailerImportRejection[],
): Promise<void> {
  try {
    const res = await model.bulkWrite(batch, { ordered: false });
    counts.created += res.upsertedCount ?? 0;
    counts.updated += res.modifiedCount ?? 0;
  } catch (error) {
    const bulkError = error as {
      result?: { upsertedCount?: number; modifiedCount?: number };
      writeErrors?: { index?: number; errmsg?: string }[];
    };
    if (!bulkError.writeErrors) throw error;

    counts.created += bulkError.result?.upsertedCount ?? 0;
    counts.updated += bulkError.result?.modifiedCount ?? 0;

    for (const writeError of bulkError.writeErrors) {
      counts.mapped -= 1;
      counts.skipped += 1;
      pushRejection(rejections, {
        row: -1,
        controlNumber: null,
        reason: writeError.errmsg ?? 'Write failed.',
      });
    }
  }
}

/** Cap the stored sample; the count keeps the total honest. */
function pushRejection(
  rejections: MailerImportRejection[],
  rejection: MailerImportRejection,
): void {
  if (rejections.length < MAILER_IMPORT_REJECTION_SAMPLE_SIZE) {
    rejections.push(rejection);
  }
}

function trackSingleValued(
  row: RawMailerRow,
  seen: Map<string, Set<string>>,
): void {
  for (const column of SINGLE_VALUED_COLUMNS) {
    const value = row[column];
    if (value === null || value === undefined || value === '') continue;
    let values = seen.get(column);
    if (!values) {
      values = new Set();
      seen.set(column, values);
    }
    // Bounded: a genuinely multi-valued column would otherwise accumulate a set
    // the size of the file. Two values is already the whole finding.
    //
    // Only primitives are stringified. A source column holding an object would
    // otherwise collapse to `[object Object]` and read as single-valued when it
    // is anything but — the exact false negative this check exists to avoid.
    if (
      values.size < 5 &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      values.add(String(value));
    }
  }
}

export { displayControlNumber };
