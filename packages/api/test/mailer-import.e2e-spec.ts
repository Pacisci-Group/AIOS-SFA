import { createReadStream } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { parse } from 'csv-parse';
import { Model } from 'mongoose';
import { importMailerRows } from '../src/common/mailers/mailer-import';
import { normalizeHeader } from '../src/common/mailers/mailer-row.mapper';
import { Mailer } from '../src/mailers/schemas/mailer.schema';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

const FIXTURE = join(__dirname, 'fixtures/mailers/rtp-sample.csv');
const AGENCY_ID = '6a86ef5140258c85a093cc4e';

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

function runImport(model: Model<Mailer>, options: { dryRun?: boolean } = {}) {
  return importMailerRows(
    fixtureRows(),
    {
      agencyId: AGENCY_ID,
      system: 'spreadsheet',
      runId: 'run-under-test',
      uploadedFilename: 'rtp-sample.csv',
      storageKey: `agencies/${AGENCY_ID}/mailer-imports/2026/abc-rtp-sample.csv`,
    },
    { model },
    { batchSize: 2, ...options },
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

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    model = app.get<Model<Mailer>>(getModelToken(Mailer.name));
    // The dedupe index is the thing under test; `dropDatabase` removes it.
    await model.syncIndexes();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('imports the fixture, rejecting the row with no control number', async () => {
    const result = await runImport(model);

    expect(result.counts.read).toBe(5);
    expect(result.counts.mapped).toBe(4);
    expect(result.counts.created).toBe(4);
    expect(result.counts.updated).toBe(0);
    expect(result.counts.skipped).toBe(1);

    // Rejected, with a reason and a row number — never dropped silently.
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].row).toBe(5);
    expect(result.rejections[0].reason).toMatch(/control number/i);

    expect(await model.countDocuments({})).toBe(4);
  });

  it('re-importing the same file updates in place: no new rows, no E11000', async () => {
    await runImport(model);
    const second = await runImport(model);

    expect(second.counts.created).toBe(0);
    expect(second.counts.updated).toBeGreaterThan(0);
    expect(await model.countDocuments({})).toBe(4);
  });

  it('resolves a mailer by either printed control-number form', async () => {
    await runImport(model);

    const byLong = await model.findOne({
      agencyId: AGENCY_ID,
      controlNumberKeys: '3F2A91C74D5E4B8A9F109C41B2D70E58',
    });
    const byShort = await model.findOne({
      agencyId: AGENCY_ID,
      controlNumberKeys: '9C41B2D70E58',
    });

    expect(byLong).not.toBeNull();
    expect(byShort?._id.toString()).toBe(byLong?._id.toString());
  });

  it('stores coerced types, not source strings', async () => {
    await runImport(model);
    const mailer = await model
      .findOne({ agencyId: AGENCY_ID, controlNumberKeys: '9C41B2D70E58' })
      .lean();

    expect(mailer?.quoteDate?.toISOString().slice(0, 10)).toBe('2026-07-13');
    expect(mailer?.squareFeet).toBe(4195);
    // Zero-padded FIPS survives the round trip.
    expect(mailer?.address?.county).toBe('017');
    expect(mailer?.coverage?.dwelling).toBe(899675);
    expect(mailer?.premium?.yearly).toBe(1886.15);
    expect(mailer?.premium?.total).toBe(3096.65);
  });

  it('carries suppression flags through, including the phone-and-donotmail case', async () => {
    await runImport(model);
    const suppressed = await model
      .findOne({ agencyId: AGENCY_ID, controlNumberKeys: '3A7F66C1904D' })
      .lean();

    expect(suppressed?.doNotMail).toBe(true);
    expect(suppressed?.phone).toBe('918-555-0142');
  });

  it('detects the file-level constants and finds them consistent', async () => {
    const result = await runImport(model, { dryRun: true });

    expect(result.detected).toMatchObject({
      agencyId: 'A0B9049',
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

    expect(result.counts.read).toBe(5);
    expect(result.counts.mapped).toBe(4);
    expect(result.counts.created).toBe(0);
    // This is what makes the preview safe to show before the operator commits.
    expect(await model.countDocuments({})).toBe(0);
  });

  it('keeps unmodelled columns recoverable in source.raw', async () => {
    await runImport(model);
    const mailer = await model
      .findOne({ agencyId: AGENCY_ID, controlNumberKeys: '9C41B2D70E58' })
      .lean();

    const raw = mailer?.source?.raw as Record<string, unknown> | undefined;
    expect(raw?.deductible).toBe('0.01');
    expect(raw?.datalabven).toBe('QB2607060729870196');
    // Empty Auto columns are not stored, but the schema still has room for them.
    expect(raw?.vehicle1).toBeUndefined();
  });
});
