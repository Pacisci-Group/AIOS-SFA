import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { MailerImportRejection } from '@sfa/shared';
import { carrierSlug } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { importMailerRows } from '../../common/mailers/mailer-import';
import {
  implicitCampaignDoc,
  implicitCampaignKey,
} from '../../common/mailers/implicit-campaign';
import { DEFAULT_MAILER_CARRIER } from '../../common/mailers/mailer-carrier';
import { parseWeekNumber } from '../../common/mailers/mailer-parse';
import { normalizeRow } from '../../common/mailers/mailer-row.mapper';
import { Carrier } from '../../carriers/schemas/carrier.schema';
import { Mailer } from '../../mailers/schemas/mailer.schema';
import { MailerCampaign } from '../../mailers/schemas/mailer-campaign.schema';
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
 * Everything past "read a row" is `importMailerRows`, the same function a
 * campaign commit runs. This file is only the reader and the agency resolution.
 * Two independently written mappers over near-identical data is how the sources
 * drift into producing different documents for the same mailer.
 *
 * ## Campaigns (PAC-71)
 *
 * `Mailer.campaignId` is required, so rows are bucketed into **implicit
 * campaigns** keyed `(agency, week, year)` — see `implicit-campaign.ts`, which
 * the `mailer-campaigns` backfill shares so a mailer imported here and one
 * stamped there land in the same campaign rather than two.
 *
 * ⚠ **Slated for deletion.** BigQuery is retired once this has run at cutover
 * (PAC-71 scope item 5); this file is kept compiling, not extended.
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

/** Agency id -> display name, for the implicit campaigns' names. */
async function loadAgencyNames(
  agencyModel: Model<Agency>,
): Promise<Map<string, string>> {
  const agencies = await agencyModel.find({}).select({ name: 1 }).lean();
  return new Map(agencies.map((a) => [a._id.toString(), a.name]));
}

/**
 * Calendar year of a `quotedate`, which BigQuery ships as an Excel serial or a
 * date string. Null when it carries neither — the implicit campaign then falls
 * into its agency's "unknown" bucket rather than inventing a year.
 */
function yearOf(raw: unknown): number | null {
  if (raw instanceof Date) return raw.getUTCFullYear();
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // The 1899-12-30 epoch every mailer date uses.
    return new Date(Date.UTC(1899, 11, 30) + raw * 86_400_000).getUTCFullYear();
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.getUTCFullYear();
  }
  return null;
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
    const campaignModel = app.get<Model<MailerCampaign>>(
      getModelToken(MailerCampaign.name),
    );
    const carrierModel = app.get<Model<Carrier>>(getModelToken(Carrier.name));

    // Every implicit campaign needs a carrier, and this script never creates
    // one — `seedCarriers` owns that catalog and a second writer would fork it.
    const carrier = await carrierModel
      .findOne({ agencyId: null, slug: carrierSlug(DEFAULT_MAILER_CARRIER) })
      .select({ _id: 1, name: 1 })
      .lean();
    if (!carrier) {
      throw new Error(
        `No global ${DEFAULT_MAILER_CARRIER} carrier. ` +
          'Run the core seed first (npm run api:seed:dev).',
      );
    }

    const agencyNames = await loadAgencyNames(agencyModel);
    const campaignIds = new Map<string, string>();

    /**
     * The implicit campaign one batch of rows belongs to, upserted on first use.
     *
     * Keyed off the **first** row of the bucket: rows arrive grouped by agency
     * and a BigQuery batch spans one file, so week and year are constant within
     * it. A bucket that did span two weeks would put the later rows in the
     * earlier week's campaign — acceptable for data that is being retired, and
     * the `mailer-campaigns` backfill regroups properly from the stored
     * documents.
     */
    const resolveCampaignId = async (
      agencyId: string,
      rows: Record<string, unknown>[],
    ): Promise<string> => {
      const first = rows[0] ?? {};
      const weekNumber =
        parseWeekNumber(first.weeknumber) ??
        parseWeekNumber(first.campaignnumber) ??
        null;
      const year = yearOf(first.quotedate);
      const key = implicitCampaignKey({ agencyId, weekNumber, year });

      const cached = campaignIds.get(key);
      if (cached) return cached;

      if (options.dryRun) {
        // Nothing is written, so a stable placeholder is enough for the mapper.
        campaignIds.set(key, new Types.ObjectId().toString());
        return campaignIds.get(key)!;
      }

      const doc = implicitCampaignDoc(
        { agencyId, weekNumber, year },
        {
          carrierId: carrier._id,
          agencyName: agencyNames.get(agencyId),
          campaignNumber:
            typeof first.campaignnumber === 'string'
              ? first.campaignnumber
              : null,
          source: 'migration',
        },
      );
      const { migrationKey, ...rest } = doc;
      const campaign = await campaignModel.findOneAndUpdate(
        { migrationKey },
        { $setOnInsert: { ...rest, migrationKey } },
        { upsert: true, new: true, projection: { _id: 1 } },
      );
      campaignIds.set(key, campaign._id.toString());
      return campaign._id.toString();
    };

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
      const campaignId = await resolveCampaignId(agencyId, rows);
      const result = await importMailerRows(
        rows,
        {
          campaignId,
          // Every row in this bucket belongs to one agency — that *was* its
          // whole tenancy — so the audience is that agency regardless of what
          // the row's `agencyid` column says.
          visibleAgencyIdsFor: () => [agencyId],
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
