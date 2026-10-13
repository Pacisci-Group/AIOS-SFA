import type { DataExportFormat } from '@sfa/shared';
import type { Model } from 'mongoose';
import type { Writable } from 'stream';
import type { ExportModels } from './engine/lookups';
import { ExportLookups } from './engine/lookups';
import { modelFor } from './engine/registry';
import type { ExportPlan } from './plan';
import { createExportWriter } from './writers/export-writer';

export interface RunExportInput {
  models: ExportModels;
  plan: ExportPlan;
  format: DataExportFormat;
  /** Where the file goes — a temp file in the worker. */
  sink: Writable;
  timeZone: string;
  maxRows: number;
  batchSize: number;
}

export interface RunExportResult {
  rowCount: number;
  bytes: number;
  /** Rows arrived between the count and the cursor; the file stops at the cap. */
  truncated: boolean;
  contentType: string;
}

/**
 * Writes one planned export to `sink` (PAC-152): a cursor in batches, one
 * round of batched label/child lookups per batch, rows written as they are
 * formed — memory stays flat however many rows there are.
 *
 * Resolves once every byte has been handed to the sink. On any failure the
 * writer is torn down and the error rethrown, so a half-written file is never
 * mistaken for a finished one: the caller discards the sink.
 */
export async function runExport({
  models,
  plan,
  format,
  sink,
  timeZone,
  maxRows,
  batchSize,
}: RunExportInput): Promise<RunExportResult> {
  const model: Model<any> = modelFor(plan.def, models);
  const columns = plan.def.columns;
  const writer = createExportWriter(format, columns, plan.def.label, sink);
  const lookups = new ExportLookups(models, plan.agencyId);

  let written = 0;
  let truncated = false;

  const writeBatch = async (batch: Record<string, unknown>[]) => {
    if (!batch.length) return;
    const joins: unknown = await plan.def.joins(batch, { lookups, timeZone });
    for (const row of batch) {
      await writer.writeRow(
        columns.map((column) => column.pick(row, { joins, lookups, timeZone })),
      );
      written += 1;
    }
  };

  const cursor = model
    .aggregate<Record<string, unknown>>(plan.pipeline)
    .allowDiskUse(true)
    .cursor({ batchSize });

  try {
    let batch: Record<string, unknown>[] = [];
    for await (const row of cursor as AsyncIterable<Record<string, unknown>>) {
      if (written + batch.length >= maxRows) {
        // Rows arrived between the request's count and this cursor. Stop at
        // the cap and say so, rather than exceed what was promised.
        truncated = true;
        break;
      }
      batch.push(row);
      if (batch.length >= batchSize) {
        await writeBatch(batch);
        batch = [];
      }
    }
    await writeBatch(batch);
    await writer.end();
  } catch (error) {
    writer.abort();
    throw error;
  } finally {
    await cursor.close().catch(() => undefined);
  }

  return {
    rowCount: written,
    bytes: writer.bytes,
    truncated,
    contentType: writer.contentType,
  };
}
