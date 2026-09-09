import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Test } from '@nestjs/testing';
import { parse } from 'csv-parse/sync';
import type {
  MailerCampaignImportCounts,
  MailerCampaignSettings,
} from '@sfa/shared';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { InngestService } from '../../src/inngest/inngest.service';
import { Carrier } from '../../src/carriers/schemas/carrier.schema';
import { Lead } from '../../src/leads/schemas/lead.schema';
import {
  MailerCampaign,
  type MailerCampaignDocument,
} from '../../src/mailers/schemas/mailer-campaign.schema';
import { MailerZipMarket } from '../../src/mailers/schemas/mailer-zip-market.schema';
import { Mailer } from '../../src/mailers/schemas/mailer.schema';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { StorageService } from '../../src/storage/storage.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { MailerCampaignCommitFn } from '../../src/worker/functions/mailer-campaign-commit.fn';
import { APPENDED_COLUMNS } from '../../src/common/mailers/mailer-processor';
import { FakeStorage } from '../helpers/fake-storage';
import { CapturedInngestService } from '../helpers/test-app';

/**
 * The commit job (PAC-71) — the only thing in this feature that writes mailers.
 *
 * What is worth asserting is the *ordering* guarantees, because every one of
 * them exists to stop a specific wrong write: overwrite imports before it
 * deletes so rows in both files keep their `_id`; a deleted row's lead is
 * unlinked rather than left dangling; the replaced campaign is superseded
 * rather than removed, because leads still point at it; and a retry between two
 * steps must not import twice.
 *
 * The fixture is the real week-29 print file — 197 rows plus one synthetic row
 * with no control number, which is what proves a rejection is *counted* rather
 * than silently dropped.
 */
const FIXTURE = join(__dirname, '../fixtures/mailers/rtp-sample.csv');

function inlineStep() {
  const ran: string[] = [];
  return {
    ran,
    step: {
      run: async <T>(
        id: string,
        fn: () => Promise<T> | T,
      ): Promise<unknown> => {
        ran.push(id);
        return await fn();
      },
    },
  };
}

/** A `step` that stops after the named step, as a mid-chain crash would. */
function stepFailingAfter(stopAfter: string) {
  const ran: string[] = [];
  return {
    ran,
    step: {
      run: async <T>(
        id: string,
        fn: () => Promise<T> | T,
      ): Promise<unknown> => {
        ran.push(id);
        const result = await fn();
        if (id === stopAfter) throw new Error('simulated crash');
        return result;
      },
    },
  };
}

describe('MailerCampaignCommitFn (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;
  let storage: FakeStorage;
  let fn: MailerCampaignCommitFn;
  let campaigns: Model<MailerCampaign>;
  let mailers: Model<Mailer>;
  let leads: Model<Lead>;
  let agencies: Model<Agency>;
  let carriers: Model<Carrier>;
  let zips: Model<MailerZipMarket>;
  let allstateId: Types.ObjectId;
  let agencyId: string;
  const captured = new CapturedInngestService();

  const csv = readFileSync(FIXTURE);
  const table = parse(csv, { columns: false }) as string[][];
  const header = table[0];
  const controlColumn = header.indexOf('controlno');

  /** The normalized dedupe key for one of the fixture's rows. */
  const keyOfRow = (index: number) =>
    table[index][controlColumn].toUpperCase().replace(/[^A-Z0-9]/g, '');

  /** A file carrying only the fixture's first `count` data rows. */
  const subset = (count: number): Buffer =>
    Buffer.from(
      [header, ...table.slice(1, count + 1)]
        .map((row) => row.map(quote).join(','))
        .join('\n'),
      'utf8',
    );

  const settings = (
    overrides: Partial<MailerCampaignSettings> = {},
  ): MailerCampaignSettings => ({
    premiumFloor: 1886.15,
    fileName: 'SFA-QBP',
    defaultMarket: 'Oklahoma City',
    marketPhones: { Tulsa: '918-984-6163' },
    defaultPhone: '405-803-7590',
    runYear: 2026,
    discounts: {
      squareFootage: [{ minSquareFeet: 2000, rate: 0.36 }],
      homeAge: { maxNewYears: 9, newRate: 0.04, oldRate: 0.1 },
    },
    zipResolutions: {},
    outputRecipients: [],
    ...overrides,
  });

  const stage = async (
    body: Buffer,
    campaign: Record<string, unknown> = {},
  ): Promise<MailerCampaignDocument> => {
    const key = storage.buildPlatformObjectKey({
      purpose: 'mailer-campaigns',
      filename: 'rtp-sample.csv',
      parts: ['vendor'],
    });
    await storage.putObject(key, body, 'text/csv');
    return campaigns.create({
      carrierId: allstateId,
      name: 'Week 29',
      campaignNumber: 'Week_Number-29',
      year: 2026,
      status: 'processing',
      source: 'vendor',
      assignment: { mode: 'all', agencyIds: [] },
      settings: settings(),
      vendorFile: {
        storageKey: key,
        name: 'rtp-sample.csv',
        size: body.byteLength,
      },
      commitMode: 'append',
      commitAttempt: 1,
      requestedBy: new Types.ObjectId(),
      preview: {
        assignment: {
          resolved: [
            { codeKey: 'A0B9049', agencyId: null, agencyName: null, rows: 198 },
          ],
          unmatched: [],
        },
      },
      ...campaign,
    });
  };

  const run = async (
    campaign: MailerCampaignDocument,
    step = inlineStep().step,
    attempt = 1,
  ) => {
    await fn.handle(
      {
        id: 'evt',
        name: 'mailers/campaign.commit.requested.v1',
        data: {
          eventLogId: new Types.ObjectId().toHexString(),
          campaignId: campaign._id.toString(),
          attempt,
          requestedBy: campaign.requestedBy?.toString() ?? '',
        },
      },
      step,
    );
    return campaigns.findById(campaign._id).lean();
  };

  beforeAll(async () => {
    storage = new FakeStorage();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
        MongooseModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.get<string>('MONGODB_URI', ''),
          }),
        }),
        InngestModule,
        WorkerModule,
      ],
    })
      .overrideProvider(StorageService)
      .useValue(storage.asService())
      // The completion email is a separate function; here it only matters that
      // the event is emitted, not that a mail server exists.
      .overrideProvider(InngestService)
      .useValue(captured)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.db!.dropDatabase();

    fn = app.get(MailerCampaignCommitFn);
    campaigns = app.get(getModelToken(MailerCampaign.name));
    mailers = app.get(getModelToken(Mailer.name));
    leads = app.get(getModelToken(Lead.name));
    agencies = app.get(getModelToken(Agency.name));
    carriers = app.get(getModelToken(Carrier.name));
    zips = app.get(getModelToken(MailerZipMarket.name));

    // ⚠ The dedupe index and the one-lead-per-mailer index are both part of
    // what is under test; `dropDatabase` removes them.
    await mailers.syncIndexes();
    await leads.syncIndexes();

    const allstate = await carriers.create({
      agencyId: null,
      name: 'Allstate',
      slug: 'allstate',
      active: true,
    });
    allstateId = allstate._id;
  });

  afterAll(async () => {
    if (app) {
      await connection.db!.dropDatabase();
      await app.close();
    }
  });

  beforeEach(async () => {
    await campaigns.deleteMany({});
    await mailers.deleteMany({});
    await leads.deleteMany({});
    await zips.deleteMany({});
    await agencies.deleteMany({});
    storage.objects.clear();

    const agency = await agencies.create({
      name: 'Smith Family Agency',
      slug: 'smith-family-agency',
      status: 'active',
      carrierAppointments: [
        {
          carrierId: allstateId,
          carrierAgencyCode: 'A0B9049',
          codeKey: 'A0B9049',
          active: true,
          isPrimary: true,
        },
      ],
    });
    agencyId = agency._id.toString();
  });

  it('writes the print file and imports every row that has a control number', async () => {
    const campaign = await stage(csv);
    const after = await run(campaign);

    expect(after?.status).toBe('imported');
    const counts = after?.importCounts as MailerCampaignImportCounts;
    expect(counts.read).toBe(198);
    // The fixture's synthetic row carries no control number, and a row that
    // vanishes between the file and the collection is indistinguishable from
    // one that was never in it — so it is rejected and *counted*.
    expect(counts.skipped).toBe(1);
    expect(counts.created).toBe(197);
    expect(await mailers.countDocuments({})).toBe(197);

    // The print file is stored, with the transform's own headers.
    expect(after?.outputFile?.name).toBe('SFA-QBP.csv');
    const output = storage.objects.get(after!.outputFile!.storageKey)!;
    const outHeaders = (
      parse(output.body, { columns: false }) as string[][]
    )[0];
    for (const column of APPENDED_COLUMNS) {
      expect(outHeaders).toContain(column);
    }

    // `mode: 'all'` stores an explicit null — "every agency, including ones
    // onboarded later" — never `[]`, which would mean nobody.
    const sample = await mailers.findOne({}).lean();
    expect(sample?.visibleAgencyIds).toBeNull();
    expect(sample?.campaignId).toBe(campaign._id.toString());
    expect(sample?.carrierAgencyId).toBe('A0B9049');
  });

  it('routes each row to the agency holding its carrier appointment', async () => {
    const campaign = await stage(csv, {
      assignment: { mode: 'carrier_agency_id', agencyIds: [] },
    });
    await run(campaign);

    const sample = await mailers.findOne({}).lean();
    expect(sample?.visibleAgencyIds).toEqual([agencyId]);
  });

  it('fails the run when a code no agency holds slips through to commit', async () => {
    await agencies.updateOne(
      { _id: agencyId },
      { $set: { carrierAppointments: [] } },
    );
    const campaign = await stage(csv, {
      assignment: { mode: 'carrier_agency_id', agencyIds: [] },
    });

    await expect(run(campaign)).rejects.toThrow(/A0B9049/);
    const after = await campaigns.findById(campaign._id).lean();
    expect(after?.status).toBe('failed');
    expect(await mailers.countDocuments({})).toBe(0);
  });

  it('append moves a row from an earlier campaign to this one', async () => {
    const first = await stage(subset(5));
    await run(first);
    const moved = await mailers.findOne({ controlNumberKeys: keyOfRow(1) });
    expect(moved?.campaignId).toBe(first._id.toString());

    const second = await stage(subset(5), { name: 'Week 29, reprint' });
    const after = await run(second);

    // The newest commit owns the mailer, and the earlier campaign's live count
    // drops. No duplicate: the upsert filters on the dedupe key.
    expect(await mailers.countDocuments({})).toBe(5);
    const again = await mailers.findOne({ controlNumberKeys: keyOfRow(1) });
    expect(again?._id.toString()).toBe(moved!._id.toString());
    expect(again?.campaignId).toBe(second._id.toString());
    expect((after?.importCounts as MailerCampaignImportCounts).created).toBe(0);
  });

  it('overwrite keeps shared rows, deletes only leftovers and supersedes', async () => {
    const first = await stage(subset(5));
    await run(first);
    const survivor = await mailers.findOne({ controlNumberKeys: keyOfRow(1) });
    const leftover = await mailers.findOne({ controlNumberKeys: keyOfRow(5) });

    // A lead on each, so the unlink rule is observable.
    const [survivorLead, leftoverLead] = await leads.create([
      {
        agencyId,
        branchId: new Types.ObjectId().toString(),
        firstName: 'Ada',
        lastName: 'Lovelace',
        mailer: {
          mailerId: survivor!._id,
          campaignId: first._id.toString(),
          controlNumberKey: keyOfRow(1),
          matchedBy: 'drawer',
        },
      },
      {
        agencyId,
        branchId: new Types.ObjectId().toString(),
        firstName: 'Grace',
        lastName: 'Hopper',
        mailer: {
          mailerId: leftover!._id,
          campaignId: first._id.toString(),
          controlNumberKey: keyOfRow(5),
          matchedBy: 'drawer',
        },
      },
    ]);

    // The new file drops the fifth row.
    const second = await stage(subset(4), {
      name: 'Week 29, corrected',
      commitMode: 'overwrite',
      replaceCampaignIds: [first._id.toString()],
      expectedDeleteCount: 1,
    });
    const after = await run(second);

    expect((after?.importCounts as MailerCampaignImportCounts).deleted).toBe(1);
    expect(await mailers.countDocuments({})).toBe(4);

    // ⚠ Import first, delete second: a row in both files keeps its `_id`, so a
    // prospect still being mailed never has a dangling lead link.
    const keptLead = await leads.findById(survivorLead._id).lean();
    expect(keptLead?.mailer?.mailerId?.toString()).toBe(
      survivor!._id.toString(),
    );
    // The deleted row's lead is unlinked rather than left pointing at nothing.
    const orphaned = await leads.findById(leftoverLead._id).lean();
    expect(orphaned?.mailer?.mailerId).toBeNull();

    // The replaced campaign keeps its record: leads still reference it through
    // `mailer.campaignId`, and attribution has to outlive the run.
    const replaced = await campaigns.findById(first._id).lean();
    expect(replaced?.status).toBe('superseded');
    expect(replaced?.supersededByCampaignId).toBe(second._id.toString());
  });

  it('links a lead that was waiting on this file, and reports a conflict', async () => {
    const branchId = new Types.ObjectId().toString();
    // Created before the campaign existed: the prospect called first.
    const waiting = await leads.create({
      agencyId,
      branchId,
      firstName: 'Early',
      lastName: 'Caller',
      mailer: {
        mailerId: null,
        campaignId: null,
        controlNumberKey: keyOfRow(1),
      },
    });
    // A second lead for the same key. One lead per mailer is platform-wide, so
    // exactly one of these can win and the other must be *reported*, never
    // linked arbitrarily.
    const rival = await leads.create({
      agencyId,
      branchId,
      firstName: 'Second',
      lastName: 'Caller',
      mailer: {
        mailerId: null,
        campaignId: null,
        controlNumberKey: keyOfRow(1),
      },
    });

    const campaign = await stage(subset(3));
    const after = await run(campaign);
    const counts = after?.importCounts as MailerCampaignImportCounts;

    expect(counts.leadsLinked).toBe(1);
    expect(counts.leadsConflicted).toBe(1);

    const linked = await leads
      .find({ _id: { $in: [waiting._id, rival._id] } })
      .lean();
    const withMailer = linked.filter((lead) => lead.mailer?.mailerId);
    expect(withMailer).toHaveLength(1);
    expect(withMailer[0].mailer?.matchedBy).toBe('control_number');
    expect(withMailer[0].mailer?.campaignId).toBe(campaign._id.toString());
  });

  it('a retry after the import does not import twice', async () => {
    const campaign = await stage(subset(5));

    const crashed = stepFailingAfter('import');
    await expect(run(campaign, crashed.step)).rejects.toThrow(
      /simulated crash/,
    );
    expect(await mailers.countDocuments({})).toBe(5);
    // Still `processing`: the crash happened *between* steps, after the import
    // body returned, so nothing marked the campaign failed. That is precisely
    // why `gate` accepts `processing` as well as `failed` — a run that died
    // mid-chain has to be resumable.
    const midway = await campaigns.findById(campaign._id).lean();
    expect(midway?.status).toBe('processing');

    // Inngest replays a failed run from the start; every step is repeat-safe,
    // which is exactly what makes that sound. The import is an upsert on the
    // dedupe key, so the second pass updates rather than inserting.
    const after = await run(await campaigns.findById(campaign._id));
    expect(await mailers.countDocuments({})).toBe(5);
    expect(after?.status).toBe('imported');
    expect((after?.importCounts as MailerCampaignImportCounts).created).toBe(0);
  });

  it('imports a processed file without transforming it a second time', async () => {
    const campaign = await stage(csv, { source: 'processed' });
    const after = await run(campaign);

    expect(after?.status).toBe('imported');
    // The transform never ran, so there are no stats and the vendor file *is*
    // the output — running it again would discount `yearlyprem` twice, the
    // exact defect the ApexReports round trip has today.
    expect(after?.stats).toBeNull();
    expect(after?.outputFile?.storageKey).toBe(after?.vendorFile?.storageKey);
    expect(await mailers.countDocuments({})).toBe(197);
  });

  it('no-ops on a superseded dispatch rather than importing again', async () => {
    const campaign = await stage(subset(5), { commitAttempt: 2 });
    const after = await run(campaign, inlineStep().step, 1);

    expect(await mailers.countDocuments({})).toBe(0);
    expect(after?.status).toBe('processing');
  });

  it('queues the completion email only when there are recipients', async () => {
    const quiet = await run(await stage(subset(2)));
    expect(quiet?.status).toBe('imported');

    const loud = await stage(subset(2), {
      name: 'With recipients',
      settings: settings({ outputRecipients: ['print@example.com'] }),
    });
    const after = await run(loud);
    expect(after?.status).toBe('imported');

    // A separate function sends the mail, so what the commit owes is the
    // event — and only when somebody is actually waiting for the file.
    expect(
      captured.sent.filter((event) =>
        event.name.includes('campaign.output-email.requested'),
      ),
    ).toHaveLength(1);
  });
});

/** Minimal CSV quoting, matching what the fixture itself uses. */
function quote(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
