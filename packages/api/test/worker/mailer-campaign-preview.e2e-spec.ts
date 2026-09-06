import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import ExcelJS from 'exceljs';
import { Connection, Model, Types } from 'mongoose';
import { Test } from '@nestjs/testing';
import type {
  MailerCampaignPreview,
  MailerCampaignSettings,
} from '@sfa/shared';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { Carrier } from '../../src/carriers/schemas/carrier.schema';
import {
  MailerCampaign,
  type MailerCampaignDocument,
} from '../../src/mailers/schemas/mailer-campaign.schema';
import { MailerZipMarket } from '../../src/mailers/schemas/mailer-zip-market.schema';
import { Mailer } from '../../src/mailers/schemas/mailer.schema';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { StorageService } from '../../src/storage/storage.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { MailerCampaignPreviewFn } from '../../src/worker/functions/mailer-campaign-preview.fn';
import { FakeStorage } from '../helpers/fake-storage';

/**
 * The preview job (PAC-71).
 *
 * Driven directly rather than through a running Inngest server: the platform's
 * retry and memoization behaviour is Inngest's to guarantee, and what is worth
 * testing here is that the numbers an operator sees are the numbers the commit
 * will honour.
 *
 * The fixture is the real week-29 print file, so the CSV path runs over data
 * with the shape a vendor actually sends. The **same data as XLSX** is asserted
 * to preview identically, which is the whole reason the reader exists.
 */
const FIXTURE = join(__dirname, '../fixtures/mailers/rtp-sample.csv');

/** Inngest's `step`, run inline. Same stand-in the invite-email suite uses. */
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

describe('MailerCampaignPreviewFn (e2e)', () => {
  let app: INestApplication;
  let connection: Connection;
  let storage: FakeStorage;
  let fn: MailerCampaignPreviewFn;
  let campaigns: Model<MailerCampaign>;
  let zips: Model<MailerZipMarket>;
  let mailers: Model<Mailer>;
  let agencies: Model<Agency>;
  let carriers: Model<Carrier>;
  let allstateId: Types.ObjectId;
  let agencyId: string;

  const csv = readFileSync(FIXTURE);

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
      squareFootage: [
        { minSquareFeet: 2500, rate: 0.44 },
        { minSquareFeet: 2000, rate: 0.36 },
        { minSquareFeet: 1500, rate: 0.32 },
        { minSquareFeet: 1000, rate: 0.29 },
      ],
      homeAge: { maxNewYears: 9, newRate: 0.04, oldRate: 0.1 },
    },
    zipResolutions: {},
    outputRecipients: [],
    ...overrides,
  });

  /** Put a file in storage and record a campaign pointing at it. */
  const upload = async (
    body: Buffer,
    filename: string,
    campaign: Record<string, unknown> = {},
  ): Promise<MailerCampaignDocument> => {
    const key = storage.buildPlatformObjectKey({
      purpose: 'mailer-campaigns',
      filename,
      parts: ['vendor'],
    });
    await storage.putObject(key, body, 'text/csv');
    return campaigns.create({
      carrierId: allstateId,
      name: `Preview ${filename}`,
      campaignNumber: 'Week_Number-29',
      year: 2026,
      status: 'uploaded',
      source: 'vendor',
      assignment: { mode: 'carrier_agency_id', agencyIds: [] },
      settings: settings(),
      vendorFile: { storageKey: key, name: filename, size: body.byteLength },
      previewAttempt: 1,
      ...campaign,
    });
  };

  const run = async (campaign: MailerCampaignDocument, attempt = 1) => {
    const { step } = inlineStep();
    await fn.handle(
      {
        id: 'evt',
        name: 'mailers/campaign.preview.requested.v1',
        data: {
          eventLogId: new Types.ObjectId().toHexString(),
          campaignId: campaign._id.toString(),
          attempt,
          requestedBy: new Types.ObjectId().toHexString(),
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
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    connection = app.get<Connection>(getConnectionToken());
    await connection.db!.dropDatabase();

    fn = app.get(MailerCampaignPreviewFn);
    campaigns = app.get(getModelToken(MailerCampaign.name));
    zips = app.get(getModelToken(MailerZipMarket.name));
    mailers = app.get(getModelToken(Mailer.name));
    agencies = app.get(getModelToken(Agency.name));
    carriers = app.get(getModelToken(Carrier.name));

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
    await zips.deleteMany({});
    await agencies.deleteMany({});

    // The fixture's rows all carry `A0B9049`.
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

  it('reports the transform, the audience and the unmapped ZIPs', async () => {
    const campaign = await upload(csv, 'rtp-sample.csv');
    const after = await run(campaign);

    expect(after?.status).toBe('previewed');
    const preview = after?.preview as MailerCampaignPreview;

    expect(preview.missingRequiredColumns).toEqual([]);
    // 197 real rows plus the fixture's synthetic control-number-less one.
    expect(preview.stats?.inputRows).toBe(198);
    expect(preview.stats?.outputRows).toBeGreaterThan(0);
    // ~95% of rows land on the floor — the discount table only prices large,
    // expensive homes. See PAC-71's findings on the week-29 run.
    expect(preview.floorHitRate).toBeGreaterThan(0.9);

    // The file says whose the rows are; nobody picked.
    expect(preview.assignment.resolved).toEqual([
      {
        codeKey: 'A0B9049',
        agencyId,
        agencyName: 'Smith Family Agency',
        rows: 198,
      },
    ]);
    expect(preview.assignment.unmatched).toEqual([]);

    // The ZIP table is empty in this test, so every ZIP in the file is
    // unmapped — which is exactly what the inline resolver is shown.
    expect(preview.unmatchedZips.length).toBeGreaterThan(0);
    expect(preview.unmatchedZips.every((zip) => /^\d{5}$/.test(zip))).toBe(
      true,
    );

    expect(after?.carrierAgencyIds).toEqual(['A0B9049']);
    expect(after?.quoteDate).toBeInstanceOf(Date);
    expect(after?.weekNumber).toBe(29);
  });

  it('resolves ZIPs from the table and from the campaign on top of it', async () => {
    const first = await upload(csv, 'rtp-sample.csv');
    const before = await run(first);
    const unmapped = (before?.preview as MailerCampaignPreview).unmatchedZips;

    await zips.create({
      agencyId: null,
      zip5: unmapped[0],
      market: 'Tulsa',
      source: 'seed',
    });
    const second = await upload(csv, 'rtp-sample.csv', {
      settings: settings({ zipResolutions: { [unmapped[1]]: '580 Group' } }),
    });
    const after = await run(second);
    const preview = after?.preview as MailerCampaignPreview;

    // Both layers apply: the stored table, and the operator's own answer.
    expect(preview.unmatchedZips).not.toContain(unmapped[0]);
    expect(preview.unmatchedZips).not.toContain(unmapped[1]);
    expect(preview.stats!.zipMatched).toBeGreaterThan(0);
  });

  it('reads the same file as XLSX to the same preview', async () => {
    const fromCsv = await run(await upload(csv, 'rtp-sample.csv'));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    for (const line of csv.toString('utf8').trim().split(/\r?\n/)) {
      sheet.addRow(parseCsvLine(line));
    }
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
    const fromXlsx = await run(await upload(xlsx, 'rtp-sample.xlsx'));

    const a = fromCsv?.preview as MailerCampaignPreview;
    const b = fromXlsx?.preview as MailerCampaignPreview;
    expect(b.stats).toEqual(a.stats);
    expect(b.unmatchedZips).toEqual(a.unmatchedZips);
    expect(b.assignment).toEqual(a.assignment);
    expect(b.rejections).toEqual(a.rejections);
  });

  it('fails with the list when a required column is missing', async () => {
    const campaign = await upload(
      Buffer.from('controlno,firstname\n#a,Ada\n', 'utf8'),
      'thin.csv',
    );
    const after = await run(campaign);

    expect(after?.status).toBe('failed');
    expect(after?.error).toContain('lastname');
    // The report is stored too: "which columns" is the entire actionable
    // content, and an operator cannot re-export from a bare error string.
    expect(
      (after?.preview as MailerCampaignPreview).missingRequiredColumns,
    ).toEqual(['lastname', 'address', 'city', 'state', 'zip']);
  });

  it('reports a code no agency holds instead of guessing', async () => {
    await agencies.updateOne(
      { _id: agencyId },
      { $set: { carrierAppointments: [] } },
    );
    const after = await run(await upload(csv, 'rtp-sample.csv'));
    const preview = after?.preview as MailerCampaignPreview;

    // Previewed, not failed: the operator has to *see* this, and the commit
    // gate is what refuses to write.
    expect(after?.status).toBe('previewed');
    expect(preview.assignment.unmatched).toEqual(['A0B9049']);
    expect(preview.assignment.resolved[0].agencyId).toBeNull();
    // Every row is unassignable, so the dry import rejects them all.
    expect(preview.rejections.length).toBeGreaterThan(0);
    expect(preview.rejections[0].reason).toContain('A0B9049');
  });

  it('counts the overlap with a campaign already holding these rows', async () => {
    const existing = await campaigns.create({
      carrierId: allstateId,
      name: 'Week 29, first run',
      campaignNumber: 'Week_Number-29',
      year: 2026,
      status: 'imported',
      source: 'vendor',
      assignment: { mode: 'all', agencyIds: [] },
    });
    // One row this file also carries, and one it does not.
    const rows = csv.toString('utf8').split(/\r?\n/);
    const shared = parseCsvLine(rows[1])[
      rows[0].split(',').indexOf('controlno')
    ];
    await mailers.create([
      {
        campaignId: existing._id.toString(),
        visibleAgencyIds: null,
        controlNumberKeys: [normalizeKey(shared)],
        source: { system: 'spreadsheet' },
      },
      {
        campaignId: existing._id.toString(),
        visibleAgencyIds: null,
        controlNumberKeys: ['NOTINTHISFILE'],
        source: { system: 'spreadsheet' },
      },
    ]);

    const after = await run(await upload(csv, 'rtp-sample.csv'));
    const preview = after?.preview as MailerCampaignPreview;

    expect(preview.existingCampaigns).toEqual([
      expect.objectContaining({
        campaignId: existing._id.toString(),
        recordCount: 2,
      }),
    ]);
    expect(preview.overlap.existingInOtherCampaigns).toBe(1);
    expect(preview.overlap.replacedRecordCount).toBe(2);
    // Only the row the new file does not carry would be deleted.
    expect(preview.overlap.deleteCountIfOverwrite).toBe(1);
  });

  it('no-ops on a stale dispatch rather than overwriting a newer preview', async () => {
    const campaign = await upload(csv, 'rtp-sample.csv', { previewAttempt: 2 });
    const after = await run(campaign, 1);

    // Untouched: a retried preview landing after a newer one would otherwise
    // replace its numbers with older ones the operator then commits against.
    expect(after?.status).toBe('uploaded');
    expect(after?.preview).toBeNull();
  });

  it('skips the transform for a file somebody else already processed', async () => {
    const campaign = await upload(csv, 'rtp-sample.csv', {
      source: 'processed',
    });
    const after = await run(campaign);

    // Running it again would discount `yearlyprem` a second time — the exact
    // defect the ApexReports round trip has today.
    expect(after?.status).toBe('previewed');
    expect((after?.preview as MailerCampaignPreview).stats).toBeNull();
    expect((after?.preview as MailerCampaignPreview).floorHitRate).toBe(0);
  });
});

/** The fixture is quoted CSV; this is enough of a parser for one line of it. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      out.push(field);
      field = '';
    } else field += char;
  }
  out.push(field);
  return out;
}

function normalizeKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
