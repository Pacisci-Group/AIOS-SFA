import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { MailerImportRejection } from '@sfa/shared';
import { Model } from 'mongoose';
import { importMailerRows } from '../../common/mailers/mailer-import';
import { normalizeRow } from '../../common/mailers/mailer-row.mapper';
import { Mailer } from '../../mailers/schemas/mailer.schema';
import { Agency } from '../../platform/schemas/agency.schema';
import { MailerBigQueryModule } from './mailer-bigquery.module';
import {
  openMailerRowStream,
  readBigQueryConfig,
  tickerFromFileName,
} from './bigquery-rows';

/**
 * Backfill the legacy mailer history from BigQuery (PAC-73).
 *
 * ## Written now, run at deploy
 *
 * Local development does not need 671,339 historical mailers — the RTP upload
 * and the demo seed both populate a working dataset. Production does need them
 * on day one, so this ships with the feature and its first real run is a deploy
 * step, gated on GCP credentials the API does not have yet.
 *
 * ## One normalizer, two sources
 *
 * Everything past "read a row" is `importMailerRows`, the same function the
 * upload path runs. This file is only the reader and the agency resolution. Two
 * independently written mappers over near-identical data is how the sources
 * drift into producing different documents for the same mailer.
 *
 * ## Re-runnable, not one-shot
 *
 * Every write is an upsert on the dedupe key, so a second run appends what is
 * new and updates what changed. That is also what makes it safe to re-run after
 * adding a missing `Agency`, which is the documented recovery for skipped
 * tickers.
 *
 * ```
 * npm run api:migrate:mailers:dev -- --dry-run --limit 500
 * npm run api:migrate:mailers:dev
 * ```
 */

interface Options {
  dryRun: boolean;
  fresh: boolean;
  limit?: number;
  batchSize: number;
}

function parseOptions(argv: string[]): Options {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const limit = parseInt(value('--limit', ''), 10);
  return {
    dryRun: has('--dry-run'),
    fresh: has('--fresh'),
    limit: Number.isFinite(limit) ? limit : undefined,
    batchSize: parseInt(value('--batch-size', '1000'), 10) || 1000,
  };
}

/**
 * Ticker -> agency id, built once up front.
 *
 * Small enough to hold in memory (one entry per tenant) and the alternative is
 * a lookup per row across 671k rows.
 */
async function loadTickerMap(
  agencyModel: Model<Agency>,
): Promise<Map<string, string>> {
  const agencies = await agencyModel
    .find({ ticker: { $type: 'string' } })
    .select({ ticker: 1 })
    .lean();

  return new Map(
    agencies
      .filter((a): a is typeof a & { ticker: string } => Boolean(a.ticker))
      .map((a) => [a.ticker.toUpperCase(), a._id.toString()]),
  );
}

async function main(): Promise<void> {
  const logger = new Logger('MailerBackfill');
  const options = parseOptions(process.argv.slice(2));

  // Read config before booting anything: a missing credential should fail in a
  // second with a clear message, not after a Mongo connection and a query.
  const config = readBigQueryConfig();
  logger.log(
    `Importing ${config.projectId}.${config.datasetId}.${config.tableId} ` +
      `(dryRun=${options.dryRun}, fresh=${options.fresh}, limit=${options.limit ?? 'none'})`,
  );

  const app = await NestFactory.createApplicationContext(MailerBigQueryModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const mailerModel = app.get<Model<Mailer>>(getModelToken(Mailer.name));
    const agencyModel = app.get<Model<Agency>>(getModelToken(Agency.name));

    const tickers = await loadTickerMap(agencyModel);
    if (tickers.size === 0) {
      throw new Error(
        'No agency has a `ticker`. Every row would be skipped. Set one (the ' +
          'core seed sets SFA) before running the backfill.',
      );
    }
    logger.log(`Known tickers: ${[...tickers.keys()].join(', ')}`);

    if (options.fresh && !options.dryRun) {
      const { deletedCount } = await mailerModel.deleteMany({
        'source.system': 'bigquery',
      });
      logger.warn(`--fresh: removed ${deletedCount} previously imported rows`);
    }

    // Rows are grouped by agency because `importMailerRows` takes one
    // `agencyId` for the whole stream — which is right for an upload (one file,
    // one agency) but not for BigQuery, where every tenant is interleaved.
    // Splitting here keeps the engine's contract honest instead of widening it
    // for a single caller.
    const perAgency = new Map<string, Record<string, unknown>[]>();
    const unmappedTickers = new Map<string, number>();
    let read = 0;
    let skippedNoTicker = 0;

    const totals = { read: 0, mapped: 0, created: 0, updated: 0, skipped: 0 };
    const rejections: MailerImportRejection[] = [];

    const flush = async (agencyId: string, rows: Record<string, unknown>[]) => {
      const result = await importMailerRows(
        rows,
        {
          agencyId,
          system: 'bigquery',
          runId: `bigquery:${config.tableId}`,
        },
        { model: mailerModel },
        { batchSize: options.batchSize, dryRun: options.dryRun },
      );
      totals.read += result.counts.read;
      totals.mapped += result.counts.mapped;
      totals.created += result.counts.created;
      totals.updated += result.counts.updated;
      totals.skipped += result.counts.skipped;
      rejections.push(...result.rejections.slice(0, 5));
    };

    const stream = openMailerRowStream(config, { limit: options.limit });

    for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
      read += 1;
      const row = normalizeRow(raw);
      const ticker = tickerFromFileName(row.filename);
      const agencyId = ticker ? tickers.get(ticker) : undefined;

      if (!agencyId) {
        // Skipped and counted, never guessed. Filing one agency's prospects
        // under another is worse than leaving them out, and a re-run picks
        // them up once the agency exists.
        skippedNoTicker += 1;
        const key = ticker ?? '(no FileName)';
        unmappedTickers.set(key, (unmappedTickers.get(key) ?? 0) + 1);
        continue;
      }

      const bucket = perAgency.get(agencyId) ?? [];
      bucket.push(row);
      perAgency.set(agencyId, bucket);

      if (bucket.length >= options.batchSize) {
        await flush(agencyId, bucket);
        perAgency.set(agencyId, []);
      }

      if (read % 50_000 === 0) {
        logger.log(`Read ${read.toLocaleString()} rows…`);
      }
    }

    for (const [agencyId, rows] of perAgency) {
      if (rows.length > 0) await flush(agencyId, rows);
    }

    logger.log('');
    logger.log(`Rows read from BigQuery : ${read.toLocaleString()}`);
    logger.log(`Rows mapped             : ${totals.mapped.toLocaleString()}`);
    logger.log(`Documents created       : ${totals.created.toLocaleString()}`);
    logger.log(`Documents updated       : ${totals.updated.toLocaleString()}`);
    logger.log(`Rows rejected           : ${totals.skipped.toLocaleString()}`);
    logger.log(`Rows skipped (no agency): ${skippedNoTicker.toLocaleString()}`);

    if (unmappedTickers.size > 0) {
      logger.warn('Unmapped tickers (add the Agency, then re-run):');
      for (const [ticker, count] of unmappedTickers) {
        logger.warn(`  ${ticker.padEnd(12)} ${count.toLocaleString()} rows`);
      }
    }
    for (const rejection of rejections.slice(0, 10)) {
      logger.warn(
        `Rejected: ${rejection.controlNumber ?? '(no QCN)'} — ${rejection.reason}`,
      );
    }
    if (options.dryRun) {
      logger.warn('--dry-run: nothing was written.');
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Mailer backfill failed:', error);
  process.exit(1);
});
