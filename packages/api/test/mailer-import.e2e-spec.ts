import { createReadStream } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { parse } from 'csv-parse';
import { Model } from 'mongoose';
import { importMailerRows } from '../src/common/mailers/mailer-import';
import {
  normalizeHeader,
  type MailerMapContext,
} from '../src/common/mailers/mailer-row.mapper';
import { Mailer } from '../src/mailers/schemas/mailer.schema';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

const FIXTURE = join(__dirname, 'fixtures/mailers/rtp-sample.csv');
const CAMPAIGN_ID = '6a86ef5140258c85a093cc4e';
const AGENCY_ID = '6a86ef5140258c85a093cc4f';

/**
 * The fixture's own rows, read as plain records.
 *
 * Assertions anchor on these rather than on literals, because the fixture is a
 * redacted slice of the real file and is meant to be re-cut from a newer one.
 * Hard-coded control numbers would turn every refresh into a test rewrite, and
 * the interesting question is whether the stored document matches its *source
 * row* — not whether it matches a number someone typed once.
 */
function readFixture(): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const out: Record<string, string>[] = [];
    createReadStream(FIXTURE)
      .pipe(
        parse({ bom: true, columns: true, skipEmptyLines: true, trim: true }),
      )
      .on('data', (row: Record<string, string>) => out.push(row))
      .on('error', reject)
      .on('end', () => resolve(out));
  });
}

/** Uppercased, non-alphanumerics stripped — what the importer stores. */
function key(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The same CSV wiring the worker uses, so the test exercises the real path. */
function fixtureRows() {
  return createReadStream(FIXTURE).pipe(
    parse({
      bom: true,
      columns: (header: string[]) => header.map(normalizeHeader),
      skipEmptyLines: true,
      relaxColumnCount: true,
      trim: true,
    }),
  );
}

function runImport(
  model: Model<Mailer>,
  options: { dryRun?: boolean } = {},
  ctx: Partial<MailerMapContext> = {},
) {
  return importMailerRows(
    fixtureRows(),
    {
      campaignId: CAMPAIGN_ID,
      visibleAgencyIdsFor: () => [AGENCY_ID],
      system: 'spreadsheet',
      runId: 'run-under-test',
      uploadedFilename: 'rtp-sample.csv',
      storageKey: `platform/mailer-campaigns/2026/${CAMPAIGN_ID}/1/rtp-sample.csv`,
      ...ctx,
    },
    { model },
    // Small batches on purpose: 197 rows over a batch of 25 forces several
    // `bulkWrite` round trips, so the batching boundary is exercised rather
    // than trivially skipped by a single flush.
    { batchSize: 25, ...options },
  );
}

/**
 * The import against a real MongoDB, including the unique index.
 *
 * The parts that matter here cannot be tested with a fake model: that a re-run
 * updates in place rather than dying on E11000, and that the dedupe index
 * actually collapses what the mapper produces. `batchSize: 2` is deliberate —
 * it forces several `bulkWrite` round trips over a five-row file so the batching
 * boundary is exercised rather than trivially skipped.
 */
describe('Mailer import (e2e)', () => {
  let app: INestApplication;
  let model: Model<Mailer>;
  let fixture: Record<string, string>[];
  /** The first fixture row that carries both control-number forms. */
  let sample: Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    model = app.get<Model<Mailer>>(getModelToken(Mailer.name));
    // The dedupe index is the thing under test; `dropDatabase` removes it.
    await model.syncIndexes();

    fixture = await readFixture();
    sample = fixture.find((r) => r.controlno && r['New Control Number'])!;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('imports the fixture, rejecting the row with no control number', async () => {
    const result = await runImport(model);

    expect(result.counts.read).toBe(198);
    expect(result.counts.mapped).toBe(197);
    expect(result.counts.created).toBe(197);
    expect(result.counts.updated).toBe(0);
    expect(result.counts.skipped).toBe(1);

    // Rejected, with a reason and a row number — never dropped silently.
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].row).toBe(198);
    expect(result.rejections[0].reason).toMatch(/control number/i);

    expect(await model.countDocuments({})).toBe(197);
  });

  it('maps every real row — the reference file rejects nothing', async () => {
    // Measured against the whole of `SFA-RTP-2026-29.csv`: 20,405 read, 20,405
    // mapped, 0 skipped. The only rejection in this fixture is the row that had
    // to be constructed, because the real file contains no such case.
    const result = await runImport(model, { dryRun: true });
    const syntheticRejections = 1;
    expect(result.counts.mapped).toBe(result.counts.read - syntheticRejections);
  });

  it('re-importing the same file updates in place: no new rows, no E11000', async () => {
    await runImport(model);
    const second = await runImport(model);

    expect(second.counts.created).toBe(0);
    expect(second.counts.updated).toBe(197);
    expect(await model.countDocuments({})).toBe(197);
  });

  it('resolves a mailer by either printed control-number form', async () => {
    await runImport(model);

    // The two forms are different strings — the short code is the last 12 hex
    // characters of the long one's UUID, which holds on 20,405/20,405 rows of
    // the real file. Legacy needed substring matching for exactly this.
    const byLong = await model.findOne({
      campaignId: CAMPAIGN_ID,
      controlNumberKeys: key(sample.controlno),
    });
    const byShort = await model.findOne({
      campaignId: CAMPAIGN_ID,
      controlNumberKeys: key(sample['New Control Number']),
    });

    expect(key(sample.controlno)).not.toEqual(
      key(sample['New Control Number']),
    );
    expect(byLong).not.toBeNull();
    expect(byShort?._id.toString()).toBe(byLong?._id.toString());
  });

  it('stores coerced types, not source strings', async () => {
    await runImport(model);
    const mailer = await model
      .findOne({
        campaignId: CAMPAIGN_ID,
        controlNumberKeys: key(sample['New Control Number']),
      })
      .lean();

    const money = (raw: string) => Number(raw.replace(/[^0-9.-]/g, ''));

    // 46216 under the 1899-12-30 epoch. Every row of the reference file
    // carries this one date.
    expect(mailer?.quoteDate?.toISOString().slice(0, 10)).toBe('2026-07-13');
    expect(mailer?.squareFeet).toBe(Number(sample.squarefeet));
    expect(mailer?.coverage?.dwelling).toBe(money(sample.dwellingli));
    expect(mailer?.premium?.yearly).toBe(money(sample.yearlyprem));
    expect(mailer?.premium?.total).toBe(money(sample.totalpremi));
    expect(mailer?.premium?.monthly).toBe(Number(sample.monthlypre));
  });

  it('keeps county a zero-padded string across every row', async () => {
    await runImport(model);
    const counties = await model.distinct('address.county', {
      campaignId: CAMPAIGN_ID,
    });

    // `Number('017')` is 17, and legacy showed producers "County: 083". Every
    // county in the real file is a 3-character zero-padded FIPS code.
    expect(counties.length).toBeGreaterThan(0);
    for (const county of counties) {
      expect(typeof county).toBe('string');
      expect(county).toMatch(/^\d{3}$/);
    }
    expect(counties).toContain(
      fixture.find((r) => r.county.startsWith('0'))!.county,
    );
  });

  it('carries suppression flags through, including the phone-and-donotmail case', async () => {
    await runImport(model);

    // 195 of the real file's 20,405 rows are `donotmail`, 18 of them with a
    // phone number. A producer cold-calling one is a compliance problem, not a
    // display nicety, so the flag has to survive the import.
    const source = fixture.find(
      (r) => r.donotmail === 'Yes' && r.phone.trim() !== '',
    )!;
    const suppressed = await model
      .findOne({
        campaignId: CAMPAIGN_ID,
        controlNumberKeys: key(source['New Control Number']),
      })
      .lean();

    expect(suppressed?.doNotMail).toBe(true);
    expect(suppressed?.phone).toBe(source.phone);
    expect(
      await model.countDocuments({ campaignId: CAMPAIGN_ID, doNotMail: true }),
    ).toBe(fixture.filter((r) => r.donotmail === 'Yes').length);
  });

  it('detects the file-level constants and finds them consistent', async () => {
    const result = await runImport(model, { dryRun: true });

    expect(result.detected).toMatchObject({
      carrierAgencyId: 'A0B9049',
      agencyName: 'SMITH FAMILY AGENCY',
      campaignNumber: 'Week_Number-29',
      weekNumber: 29,
      fileName: 'SFA-20P',
      policyType: 'Home',
      product: 'FQ',
    });
    expect(result.detected?.quoteDate?.slice(0, 10)).toBe('2026-07-13');
    // "One file = one campaign, one agency, one product" holds for this file.
    expect(result.inconsistentColumns).toEqual([]);
  });

  it('a dry run reports everything and writes nothing', async () => {
    const result = await runImport(model, { dryRun: true });

    expect(result.counts.read).toBe(198);
    expect(result.counts.mapped).toBe(197);
    expect(result.counts.created).toBe(0);
    // This is what makes the preview safe to show before the operator commits.
    expect(await model.countDocuments({})).toBe(0);
  });

  it('stamps the campaign and the row-level audience on every document', async () => {
    await runImport(model);
    const mailer = await model
      .findOne({
        campaignId: CAMPAIGN_ID,
        controlNumberKeys: key(sample['New Control Number']),
      })
      .lean();

    expect(mailer?.campaignId).toBe(CAMPAIGN_ID);
    expect(mailer?.visibleAgencyIds).toEqual([AGENCY_ID]);
    // Every row of this fixture carries the same code; the point is that it
    // reaches its own field, uppercased, rather than only `source.raw`.
    expect(mailer?.carrierAgencyId).toBe('A0B9049');
    expect(mailer).not.toHaveProperty('agencyId');
  });

  it('stores a literal null for a campaign visible to every agency', async () => {
    // ⚠ The trap this pins: Mongoose defaults an array prop to `[]`, and `[]`
    // means "visible to nobody". `bulkWrite` bypasses casting, so this asserts
    // what actually reaches Mongo — and that the `$type: 'null'` visibility
    // query the drawer runs will match it.
    await runImport(model, {}, { visibleAgencyIdsFor: () => null });

    const global = await model.countDocuments({
      visibleAgencyIds: { $type: 'null' },
    });
    expect(global).toBe(197);
    expect(await model.countDocuments({ visibleAgencyIds: [] })).toBe(0);
  });

  it('rejects every row when no agency holds the file carrier agency code', async () => {
    // Blocking is the point: filing one agency's prospects under another, or
    // dropping them silently, are both worse than refusing the file.
    const result = await runImport(
      model,
      {},
      { visibleAgencyIdsFor: () => undefined },
    );

    expect(result.counts.mapped).toBe(0);
    // 197 unassignable rows plus the one with no control number.
    expect(result.counts.skipped).toBe(198);
    expect(result.rejections[0].reason).toBe(
      'No agency is assigned for carrier agency code A0B9049.',
    );
    expect(await model.countDocuments({})).toBe(0);
  });

  it('moves a mailer to the newest campaign that imports it', async () => {
    // Append semantics, and the reason the upsert filter carries no campaign
    // clause: the row already exists, so it is updated in place and re-pointed.
    // A campaign-scoped filter would insert a second copy and die on E11000.
    await runImport(model);
    const second = await runImport(
      model,
      {},
      {
        campaignId: '6a86ef5140258c85a093cc50',
        visibleAgencyIdsFor: () => ['6a86ef5140258c85a093cc51'],
      },
    );

    expect(second.counts.created).toBe(0);
    expect(second.counts.updated).toBe(197);
    expect(await model.countDocuments({ campaignId: CAMPAIGN_ID })).toBe(0);
    expect(
      await model.countDocuments({ campaignId: '6a86ef5140258c85a093cc50' }),
    ).toBe(197);
  });

  it('keeps unmodelled columns recoverable in source.raw', async () => {
    await runImport(model);
    const mailer = await model
      .findOne({
        campaignId: CAMPAIGN_ID,
        controlNumberKeys: key(sample['New Control Number']),
      })
      .lean();

    const raw = mailer?.source?.raw as Record<string, unknown> | undefined;
    // Carl's unused passthroughs, and the duplicate of `totalpremi`.
    expect(raw?.deductible).toBe(sample.deductible);
    expect(raw?.coveragest).toBe(sample.coveragest);
    // ⚠ `status` is postal/DPV metadata (`SNNNN4`), **not** a campaign status.
    // Nothing may promote it into one — see PAC-61 open item 3.
    expect(raw?.status).toBe(sample.status);
    // Empty Auto columns are not stored, but the schema still has room for
    // them: they are blank because this is a Home/FQ file, not because the
    // format lacks them.
    expect(raw?.vehicle1).toBeUndefined();
    expect(raw?.premium1).toBeUndefined();
  });
});
