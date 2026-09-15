import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve as resolvePath } from 'path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { MailerImportRejection } from '@sfa/shared';
import { carrierSlug, mailerControlNumberKeys } from '@sfa/shared';
import { Connection, Model, Types } from 'mongoose';
import { importMailerRows } from '../../common/mailers/mailer-import';
import {
  implicitCampaignDoc,
  implicitCampaignKey,
  type ImplicitCampaignKeyInput,
} from '../../common/mailers/implicit-campaign';
import { DEFAULT_MAILER_CARRIER } from '../../common/mailers/mailer-carrier';
import { parseText } from '../../common/mailers/mailer-parse';
import {
  mailerWeekNumber,
  normalizeRow,
} from '../../common/mailers/mailer-row.mapper';
import { Carrier } from '../../carriers/schemas/carrier.schema';
import { Mailer } from '../../mailers/schemas/mailer.schema';
import { MailerCampaign } from '../../mailers/schemas/mailer-campaign.schema';
import { Agency } from '../../platform/schemas/agency.schema';
import { MailerBigQueryModule } from './mailer-bigquery.module';
import {
  campaignYear,
  openMailerRowStream,
  readBigQueryConfig,
  resolveRowTicker,
} from './bigquery-rows';
import { type BackfillOptions, parseBackfillOptions } from './import-options';
import {
  type LeadLinkReport,
  linkPendingLeads,
  type ResolvedMailer,
} from './link-pending-leads';
import { planRunRollback, type RunRollbackPlan } from './run-rollback';

/**
 * Backfill the legacy mailer history from BigQuery (PAC-73).
 *
 * ## Two kinds of run
 *
 * **Full** (no selection flags) reads every row and upserts it. This is the
 * cutover run. Running it again re-`$set`s every stored mailer.
 *
 * **Catch-up** (`--file` / `--ingested-since`, with `--add-only`) reads only
 * the rows the selection names and inserts only the mailers AIOS does not hold
 * yet. A stored mailer is never modified: not moved to another campaign, not
 * re-priced, not re-stamped. Leads and producers already point at those
 * documents. Written for September 2026, when the cutover had skipped five
 * `FileName`s that do not start with a ticker, and Mail Companion kept
 * uploading after it.
 *
 * ```
 * # From the repo root. The credentials are the service-account key, on one line.
 * export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(node -e 'process.stdout.write(JSON.stringify(require("./temp/<key>.json")))')"
 *
 * npm run migrate:mailers:dev -w @sfa/api -- --dry-run \
 *   --add-only --link-leads --run-id bigquery:catchup-2026-09 \
 *   --file 'April_P (3)' --assign-file 'April_P (3)=SFA' \
 *   --ingested-since 2026-09-09T20:13:00Z \
 *   --report ../../temp/mailer-catchup-dry-run.json
 * ```
 *
 * Every flag is checked before anything connects; see `import-options.ts`.
 *
 * ## One normalizer, two sources
 *
 * Everything past "read a row" is `importMailerRows`, the same function a
 * campaign commit runs. This file is only the reader, the agency resolution and
 * the campaign grouping. Two independently written mappers over near-identical
 * data is how the sources drift into producing different documents for the
 * same mailer.
 *
 * ## Campaigns (PAC-71)
 *
 * `Mailer.campaignId` is required, so rows are grouped into **implicit
 * campaigns** keyed `(agency, week, year)`; see `implicit-campaign.ts`. The key
 * is computed **per row**, from the same week the mapper stores
 * (`mailerWeekNumber`) and a year read by the mapper's own date parser
 * (`campaignYear`). The cutover run keyed each 1,000-row batch off its first
 * row and read serial dates as five-digit years; both are fixed here, but the
 * campaigns the cutover created are left as they are.
 *
 * An add-only run creates a campaign only once it has a mailer to put in it, so
 * a file that turns out to be entirely present already leaves no empty campaign
 * behind.
 *
 * ## Undoing a run
 *
 * A live add-only run's report ends with the mongosh commands that undo it:
 * unlink the leads, delete the mailers, delete the campaigns left empty. They
 * are read back from the database (`run-rollback.ts`), so the latest report of a
 * re-run undoes the whole import, not just its last pass.
 *
 * ## Re-runnable, not one-shot
 *
 * Every write is keyed on the control number, so a second run of the same
 * command writes nothing new. That is also what makes a full run safe to repeat
 * after adding a missing `Agency`, the documented recovery for skipped tickers.
 *
 * ⚠ **Slated for deletion** once Mail Companion stops writing to BigQuery
 * (PAC-71 scope item 5).
 */

/** Marks a mailer id a dry run made up. Never written anywhere. */
const DRY_RUN_MAILER_PREFIX = 'dry-run:';

interface CampaignRecord {
  key: string;
  id: string;
  name: string;
  agencyId: string;
  weekNumber: number | null;
  year: number | null;
  /** Created by this run, or on a dry run, would be. */
  created: boolean;
  /** Mailers this run put in it (on a dry run, would put). */
  mailersWritten: number;
}

/** What one source file contributed to one campaign. */
interface FileTally {
  fileName: string;
  ticker: string;
  campaignKey: string;
  weekNumber: number | null;
  year: number | null;
  campaignNumbers: Set<string>;
  read: number;
  /** Add-only: rows whose control number AIOS already holds. */
  alreadyPresent: number;
  /** Add-only: rows repeating a control number an earlier row of this run took. */
  repeatedInRun: number;
  mapped: number;
  created: number;
  updated: number;
  rejected: number;
}

interface Bucket {
  input: ImplicitCampaignKeyInput;
  tally: FileTally;
  rows: Record<string, unknown>[];
}

/** A planned mailer for a dry run's lead plan, with who may see it. */
interface PlannedMailer extends ResolvedMailer {
  agencyId: string;
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

function describeSelection(options: BackfillOptions): string {
  const parts: string[] = [];
  if (options.fileNames.length > 0) {
    const names = options.fileNames.map((name) => `"${name}"`).join(', ');
    parts.push(`FileName in [${names}]`);
  }
  if (options.ingestedSince) {
    parts.push(`uploaded at or after ${options.ingestedSince}`);
  }
  const selection = parts.length > 0 ? parts.join(' OR ') : 'every row';
  return options.limit ? `${selection} (first ${options.limit})` : selection;
}

async function main(): Promise<void> {
  const logger = new Logger('MailerBackfill');

  // Config and flags before booting anything: a missing credential or a
  // mistyped flag should fail in a second, not after a Mongo connection.
  const config = readBigQueryConfig();
  const options = parseBackfillOptions(process.argv.slice(2), config.tableId);
  const startedAt = new Date();

  logger.log(
    `Source    : ${config.projectId}.${config.datasetId}.${config.tableId}`,
  );
  logger.log(
    `Mode      : ${options.dryRun ? 'DRY RUN (nothing is written)' : 'LIVE'}, ` +
      `${options.addOnly ? 'add-only' : 'upsert'}, run id ${options.runId}`,
  );
  logger.log(`Selection : ${describeSelection(options)}`);
  for (const [fileName, ticker] of options.assignments) {
    logger.log(`Assign    : "${fileName}" -> ${ticker}`);
  }

  const app = await NestFactory.createApplicationContext(MailerBigQueryModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const connection = app.get<Connection>(getConnectionToken());
    const target = `${connection.host}:${connection.port}/${connection.name}`;
    logger.log(`Target    : ${target}`);

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
    const tickers = await loadTickerMap(agencyModel);
    if (tickers.size === 0) {
      throw new Error(
        'No agency has a `ticker`. Every row would be skipped. Set one (the ' +
          'core seed sets SFA) before running the backfill.',
      );
    }
    logger.log(`Tickers   : ${[...tickers.keys()].join(', ')}`);
    for (const [fileName, ticker] of options.assignments) {
      if (!tickers.has(ticker)) {
        throw new Error(
          `--assign-file "${fileName}=${ticker}": no agency has the ticker ${ticker}.`,
        );
      }
    }

    if (options.fresh && !options.dryRun) {
      const { deletedCount } = await mailerModel.deleteMany({
        'source.system': 'bigquery',
      });
      logger.warn(`--fresh: removed ${deletedCount} previously imported rows`);
    }

    const mailersBefore = await mailerModel.countDocuments({});

    const campaigns = new Map<string, CampaignRecord>();

    /**
     * The implicit campaign for one `(agency, week, year)`, created on first
     * use. Existing ones are reused as they are; only a new one is written.
     */
    const resolveCampaign = async (
      input: ImplicitCampaignKeyInput,
      firstRow: Record<string, unknown>,
    ): Promise<CampaignRecord> => {
      const key = implicitCampaignKey(input);
      const cached = campaigns.get(key);
      if (cached) return cached;

      const doc = implicitCampaignDoc(input, {
        carrierId: carrier._id,
        agencyName: agencyNames.get(input.agencyId),
        campaignNumber: parseText(firstRow.campaignnumber) ?? null,
        source: 'migration',
      });
      const { migrationKey, ...rest } = doc;
      const record: CampaignRecord = {
        key,
        id: '',
        name: String(rest.name),
        agencyId: input.agencyId,
        weekNumber: input.weekNumber,
        year: input.year,
        created: false,
        mailersWritten: 0,
      };

      const existing = await campaignModel
        .findOne({ migrationKey })
        .select({ _id: 1, name: 1 })
        .lean();
      if (existing) {
        record.id = existing._id.toString();
        record.name = existing.name;
      } else if (options.dryRun) {
        // Nothing is written, so a stable placeholder is enough for the mapper.
        record.id = new Types.ObjectId().toString();
        record.created = true;
      } else {
        const campaign = await campaignModel.findOneAndUpdate(
          { migrationKey },
          { $setOnInsert: { ...rest, migrationKey } },
          { upsert: true, new: true, projection: { _id: 1 } },
        );
        record.id = campaign._id.toString();
        record.created = true;
      }

      campaigns.set(key, record);
      return record;
    };

    const buckets = new Map<string, Bucket>();
    const unmappedTickers = new Map<string, number>();
    const rejections: MailerImportRejection[] = [];
    /** Add-only: every control-number key this run has queued for insert. */
    const seenKeys = new Set<string>();
    /** Dry run with `--link-leads`: the mailer each queued key would become. */
    const plannedMailers = new Map<string, PlannedMailer>();
    let read = 0;
    let skippedNoTicker = 0;

    const flush = async (bucket: Bucket): Promise<void> => {
      const rows = bucket.rows;
      bucket.rows = [];
      const { tally } = bucket;

      let toWrite = rows;
      if (options.addOnly) {
        const rowKeys = rows.map((row) =>
          mailerControlNumberKeys(row.controlno, row.newcontrolnumber),
        );
        const lookup = [...new Set(rowKeys.flat())];
        // The engine's `$type` clause, for the engine's reason: without it the
        // partial dedupe index is unusable and this becomes a collection scan.
        const stored = new Set(
          lookup.length === 0
            ? []
            : (
                await mailerModel
                  .find({ controlNumberKeys: { $in: lookup, $type: 'string' } })
                  .select({ controlNumberKeys: 1 })
                  .lean()
              ).flatMap((mailer) => mailer.controlNumberKeys),
        );

        toWrite = [];
        for (const [index, row] of rows.entries()) {
          const keys = rowKeys[index];
          // `seenKeys` first: on a live run a key an earlier batch inserted is
          // also in the database, and a dry run must count that row the same.
          if (keys.some((key) => seenKeys.has(key))) {
            tally.repeatedInRun += 1;
          } else if (keys.some((key) => stored.has(key))) {
            tally.alreadyPresent += 1;
          } else {
            for (const key of keys) seenKeys.add(key);
            toWrite.push(row);
          }
        }
      }
      if (toWrite.length === 0) return;

      const campaign = await resolveCampaign(bucket.input, toWrite[0]);
      const result = await importMailerRows(
        toWrite,
        {
          campaignId: campaign.id,
          // Every row in this bucket belongs to one agency — that *was* its
          // whole tenancy — so the audience is that agency regardless of what
          // the row's `agencyid` column says.
          visibleAgencyIdsFor: () => [bucket.input.agencyId],
          system: 'bigquery',
          runId: options.runId,
        },
        { model: mailerModel },
        {
          batchSize: options.batchSize,
          dryRun: options.dryRun,
          onExisting: options.addOnly ? 'skip' : 'update',
        },
      );

      tally.mapped += result.counts.mapped;
      tally.created += result.counts.created;
      tally.updated += result.counts.updated;
      tally.rejected += result.counts.skipped;
      campaign.mailersWritten += options.dryRun
        ? result.counts.mapped
        : result.counts.created + result.counts.updated;
      rejections.push(...result.rejections.slice(0, 5));

      if (options.dryRun && options.linkLeads) {
        for (const row of toWrite) {
          const keys = mailerControlNumberKeys(
            row.controlno,
            row.newcontrolnumber,
          );
          if (keys.length === 0) continue;
          const planned: PlannedMailer = {
            mailerId: `${DRY_RUN_MAILER_PREFIX}${keys[0]}`,
            campaignId: campaign.id,
            agencyId: bucket.input.agencyId,
          };
          for (const key of keys) plannedMailers.set(key, planned);
        }
      }
    };

    const stream = openMailerRowStream(config, {
      fileNames: options.fileNames,
      ingestedSince: options.ingestedSince,
      limit: options.limit,
      // Add-only keeps the first row it sees for a control number, so the
      // newest has to come first. See the ordering note on the stream.
      newestFirst: options.addOnly,
    });

    for await (const raw of stream as AsyncIterable<Record<string, unknown>>) {
      read += 1;
      const row = normalizeRow(raw);
      const ticker = resolveRowTicker(row.filename, options.assignments);
      const agencyId = ticker ? tickers.get(ticker) : undefined;

      if (!ticker || !agencyId) {
        // Skipped and counted, never guessed. Filing one agency's prospects
        // under another is worse than leaving them out, and a re-run picks
        // them up once the agency exists (or the file is assigned).
        skippedNoTicker += 1;
        const key = ticker ?? `(no ticker: ${parseText(row.filename) ?? ''})`;
        unmappedTickers.set(key, (unmappedTickers.get(key) ?? 0) + 1);
        continue;
      }

      const input: ImplicitCampaignKeyInput = {
        agencyId,
        weekNumber: mailerWeekNumber(row) ?? null,
        year: campaignYear(row.quotedate),
      };
      const campaignKey = implicitCampaignKey(input);
      const fileName = parseText(row.filename) ?? '(no FileName)';
      const bucketKey = `${campaignKey} ${fileName}`;

      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = {
          input,
          rows: [],
          tally: {
            fileName,
            ticker,
            campaignKey,
            weekNumber: input.weekNumber,
            year: input.year,
            campaignNumbers: new Set(),
            read: 0,
            alreadyPresent: 0,
            repeatedInRun: 0,
            mapped: 0,
            created: 0,
            updated: 0,
            rejected: 0,
          },
        };
        buckets.set(bucketKey, bucket);
      }

      bucket.tally.read += 1;
      const campaignNumber = parseText(row.campaignnumber);
      if (campaignNumber) bucket.tally.campaignNumbers.add(campaignNumber);
      bucket.rows.push(row);

      if (bucket.rows.length >= options.batchSize) {
        await flush(bucket);
      }
      if (read % 50_000 === 0) {
        logger.log(`Read ${read.toLocaleString()} rows…`);
      }
    }

    for (const bucket of buckets.values()) {
      if (bucket.rows.length > 0) await flush(bucket);
    }

    let leads: LeadLinkReport | null = null;
    if (options.linkLeads) {
      const db = connection.db;
      if (!db) throw new Error('The Mongo connection has no database handle.');
      const agencyIds = [
        ...new Set([...buckets.values()].map((b) => b.input.agencyId)),
      ];
      leads = await linkPendingLeads(db, {
        agencyIds,
        dryRun: options.dryRun,
        resolve: options.dryRun
          ? (key, agencyId) => {
              const planned = plannedMailers.get(key);
              return Promise.resolve(
                planned && planned.agencyId === agencyId
                  ? {
                      mailerId: planned.mailerId,
                      campaignId: planned.campaignId,
                    }
                  : null,
              );
            }
          : async (key, agencyId) => {
              // Only a mailer this run wrote, and only one the lead's agency
              // may see — the drawer's own visibility rule.
              const mailer = await mailerModel
                .findOne({
                  controlNumberKeys: { $in: [key], $type: 'string' },
                  'source.runId': options.runId,
                  $or: [
                    { visibleAgencyIds: { $type: 'null' } },
                    { visibleAgencyIds: agencyId },
                  ],
                })
                .select({ campaignId: 1 })
                .lean();
              return mailer
                ? {
                    mailerId: mailer._id.toString(),
                    campaignId: mailer.campaignId,
                  }
                : null;
            },
      });
    }

    const mailersAfter = options.dryRun
      ? mailersBefore
      : await mailerModel.countDocuments({});

    const tallies = [...buckets.values()].map((bucket) => bucket.tally);
    const sum = (pick: (tally: FileTally) => number) =>
      tallies.reduce((total, tally) => total + pick(tally), 0);
    const totals = {
      alreadyPresent: sum((t) => t.alreadyPresent),
      repeatedInRun: sum((t) => t.repeatedInRun),
      mapped: sum((t) => t.mapped),
      created: sum((t) => t.created),
      updated: sum((t) => t.updated),
      rejected: sum((t) => t.rejected),
    };
    const campaignList = [...campaigns.values()];

    const n = (value: number) => value.toLocaleString();
    const verb = options.dryRun ? 'would be' : 'were';
    logger.log('');
    logger.log(`Rows read from BigQuery    : ${n(read)}`);
    logger.log(`Rows skipped (no agency)   : ${n(skippedNoTicker)}`);
    if (options.addOnly) {
      logger.log(`Rows already in AIOS       : ${n(totals.alreadyPresent)}`);
      logger.log(`Rows repeating a key       : ${n(totals.repeatedInRun)}`);
    }
    if (options.dryRun) {
      logger.log(`Mailers to be written      : ${n(totals.mapped)}`);
    } else {
      logger.log(`Mailers created            : ${n(totals.created)}`);
      logger.log(`Mailers updated            : ${n(totals.updated)}`);
    }
    logger.log(`Rows rejected              : ${n(totals.rejected)}`);
    logger.log(
      `Mailers in the collection  : ${n(mailersBefore)} -> ${n(mailersAfter)}`,
    );

    logger.log('');
    logger.log('Per file:');
    for (const tally of tallies) {
      const written = options.dryRun ? tally.mapped : tally.created;
      logger.log(
        `  ${tally.fileName.padEnd(22)} ${tally.ticker.padEnd(4)} ` +
          `week ${String(tally.weekNumber ?? '?').padStart(2)} ${tally.year ?? '????'}  ` +
          `read ${n(tally.read).padStart(7)}  present ${n(tally.alreadyPresent).padStart(7)}  ` +
          `${options.dryRun ? 'to write' : 'created'} ${n(written).padStart(7)}`,
      );
    }

    logger.log('');
    logger.log('Campaigns:');
    for (const campaign of campaignList) {
      const state = campaign.created
        ? options.dryRun
          ? 'would be created'
          : 'created'
        : 'existing';
      logger.log(
        `  ${campaign.name} (${state}) — ${n(campaign.mailersWritten)} mailers ${verb} added`,
      );
    }

    if (leads) {
      logger.log('');
      logger.log(`Leads waiting on a mailer  : ${n(leads.pendingLeads)}`);
      logger.log(`  matched a mailer this run: ${n(leads.matchedLeads)}`);
      logger.log(
        `${(options.dryRun ? '  to be linked' : '  linked').padEnd(27)}: ${n(leads.linked)}`,
      );
      logger.log(
        `  left for a person        : ${n(leads.conflicts.reduce((t, c) => t + c.leadIds.length, 0))} ` +
          `(${n(leads.conflicts.length)} mailers claimed by several leads)`,
      );
      if (leads.lostRace.length > 0) {
        logger.warn(`  linked elsewhere mid-run : ${n(leads.lostRace.length)}`);
      }
    }

    if (unmappedTickers.size > 0) {
      logger.warn(
        'Unmapped tickers (add the Agency or --assign-file, then re-run):',
      );
      for (const [ticker, count] of unmappedTickers) {
        logger.warn(`  ${ticker.padEnd(24)} ${n(count)} rows`);
      }
    }
    for (const rejection of rejections.slice(0, 10)) {
      logger.warn(
        `Rejected: ${rejection.controlNumber ?? '(no QCN)'} — ${rejection.reason}`,
      );
    }
    if (options.addOnly && !options.dryRun && totals.updated > 0) {
      logger.error(
        `${n(totals.updated)} stored mailers were modified by an add-only run. ` +
          'That should be impossible: stop and investigate before re-running.',
      );
    }
    if (!options.dryRun && mailersAfter - mailersBefore !== totals.created) {
      logger.warn(
        `The collection grew by ${n(mailersAfter - mailersBefore)} but this run ` +
          `created ${n(totals.created)}; another writer was active during the run.`,
      );
    }

    // Only a live add-only run can be undone by its run id: an upsert also
    // rewrote mailers that existed before it, and deleting by that id would
    // take them too. `run-rollback.ts` explains why the plan is read back from
    // the database rather than from this pass's own counts.
    let rollback: RunRollbackPlan | null = null;
    if (!options.dryRun && options.addOnly) {
      const db = connection.db;
      if (!db) throw new Error('The Mongo connection has no database handle.');
      rollback = await planRunRollback(db, options.runId);
      logger.log('');
      logger.log(
        `Rollback  : ${n(rollback.mailers)} mailers, ${n(rollback.leadIds.length)} leads, ` +
          `${n(rollback.campaignIds.length)} campaigns carry ${options.runId} (commands in the report)`,
      );
    }

    const report = {
      runId: options.runId,
      mode: options.dryRun ? 'dry-run' : 'live',
      addOnly: options.addOnly,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      target,
      source: `${config.projectId}.${config.datasetId}.${config.tableId}`,
      selection: {
        fileNames: options.fileNames,
        ingestedSince: options.ingestedSince ?? null,
        limit: options.limit ?? null,
      },
      assignments: Object.fromEntries(options.assignments),
      mailers: { before: mailersBefore, after: mailersAfter },
      rows: {
        read,
        skippedNoAgency: skippedNoTicker,
        unmappedTickers: Object.fromEntries(unmappedTickers),
      },
      totals,
      files: tallies.map((tally) => ({
        ...tally,
        campaignNumbers: [...tally.campaignNumbers],
      })),
      campaigns: campaignList,
      leads,
      rejections: rejections.slice(0, 20),
      rollback,
    };

    if (options.reportPath) {
      const path = resolvePath(options.reportPath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
      logger.log('');
      logger.log(`Report    : ${path}`);
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
