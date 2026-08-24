import { Readable } from 'stream';
import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection, Model } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { StorageService } from '../../src/storage/storage.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { ImportMailersFn } from '../../src/worker/functions/import-mailers.fn';
import { Mailer } from '../../src/mailers/schemas/mailer.schema';
import { MailerImportRun } from '../../src/mailers/schemas/mailer-import-run.schema';
import { Agency } from '../../src/platform/schemas/agency.schema';
import type { MailerImportRequestedData } from '../../src/inngest/events';

const AGENCY_ID = '507f1f77bcf86cd799439012';
const STORAGE_KEY = `agencies/${AGENCY_ID}/mailer-imports/2026/abc-rtp.csv`;

/** Two rows: one complete, one with no control number in either column. */
const CSV = `controlno,New Control Number,firstname,lastname,address,city,state,zip,county,squarefeet,yearbuilt,dwellingli,totalpremi,yearlyprem,monthlypre,Campaign Number,FileName,type,product,quotedate,agencyid,agencyname,donotmail
#3f2a91c7-4d5e-4b8a-9f10-9c41b2d70e58,9c41b2d70e58,Dana,Okafor,1420 S Cheyenne Ave,Bartlesville,OK,74003-5807,017,4195,1998,"$899,675.00",3096.65,$1886.15/year*,157.18,Week_Number-29,SFA-20P,Home,FQ,46216,A0B9049,SMITH FAMILY AGENCY,No
,,Rowan,Fitzgerald,1201 S Main St,Tulsa,OK,74119-0900,143,1900,1988,"$300,000.00",1500.00,$1500.00/year*,125.00,Week_Number-29,SFA-20P,Home,FQ,46216,A0B9049,SMITH FAMILY AGENCY,No
`;

/**
 * Serves the CSV from memory instead of object storage.
 *
 * The only collaborator worth substituting: MinIO is not the thing under test,
 * and a fresh `Readable` per call is what lets the commit re-stream the same
 * bytes the preview read — which is exactly what the real UUID-suffixed,
 * immutable object key guarantees.
 */
class InMemoryStorage {
  reads = 0;
  getObjectStream(key: string): Promise<Readable> {
    if (key !== STORAGE_KEY) {
      return Promise.reject(new Error(`unexpected key: ${key}`));
    }
    this.reads += 1;
    return Promise.resolve(Readable.from([CSV]));
  }
}

/**
 * Inngest's step tooling, running each step inline.
 *
 * The platform's retry and memoization behaviour is Inngest's to guarantee; the
 * thing worth testing is our handler, and that only needs `run` to invoke its
 * callback. Same seam `send-invite-email.e2e-spec.ts` uses.
 */
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

function event(data: MailerImportRequestedData): {
  id: string;
  name: string;
  data: MailerImportRequestedData;
} {
  return { id: '01ABCDEF', name: 'mailers/import.commit.requested.v1', data };
}

describe('ImportMailersFn (e2e)', () => {
  let app: INestApplication;
  let fn: ImportMailersFn;
  let storage: InMemoryStorage;
  let mailers: Model<Mailer>;
  let runs: Model<MailerImportRun>;
  let agencies: Model<Agency>;

  beforeAll(async () => {
    storage = new InMemoryStorage();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
        MongooseModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.get<string>(
              'MONGODB_URI',
              'mongodb://localhost:27017/sfa_test',
            ),
          }),
        }),
        InngestModule,
        WorkerModule,
      ],
    })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    fn = app.get(ImportMailersFn);
    mailers = app.get<Model<Mailer>>(getModelToken(Mailer.name));
    runs = app.get<Model<MailerImportRun>>(getModelToken(MailerImportRun.name));
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));

    // The dedupe index is load-bearing for the re-run assertion below, and
    // `dropDatabase` in a sibling suite removes it.
    await mailers.syncIndexes();
  });

  afterAll(async () => {
    if (app) {
      const connection = app.get<Connection>(getConnectionToken());
      await connection.db?.dropDatabase();
      await app.close();
    }
  });

  beforeEach(async () => {
    storage.reads = 0;
    await mailers.deleteMany({});
    await runs.deleteMany({});
    await agencies.deleteMany({ _id: AGENCY_ID });
  });

  /** A run in the state the API leaves it in before dispatching the event. */
  async function seedRun(status: 'previewing' | 'importing') {
    const run = await runs.create({
      _id: AGENCY_ID.replace('2', '9'),
      agencyId: AGENCY_ID,
      storageKey: STORAGE_KEY,
      uploadedFilename: 'SFA-RTP-2026-29.csv',
      sizeBytes: CSV.length,
      status,
      requestedBy: '507f1f77bcf86cd799439011',
    });
    return {
      importRunId: run._id.toString(),
      agencyId: AGENCY_ID,
      storageKey: STORAGE_KEY,
      requestedBy: '507f1f77bcf86cd799439011',
    };
  }

  it('previews without writing a single mailer', async () => {
    const data = await seedRun('previewing');
    const { step, ran } = inlineStep();

    const counts = await fn.handle(event(data), step, 'preview');

    expect(ran).toEqual(['import']);
    expect(counts.read).toBe(2);
    expect(counts.created).toBe(0);
    // The whole point of the preview: the operator sees the file's contents
    // and the database is untouched.
    expect(await mailers.countDocuments({})).toBe(0);

    const run = await runs.findById(data.importRunId).lean();
    expect(run?.status).toBe('previewed');
    expect(run?.detected?.agencyId).toBe('A0B9049');
    expect(run?.detected?.weekNumber).toBe(29);
    expect(run?.counts?.skipped).toBe(1);
    expect(run?.rejections?.[0]?.reason).toMatch(/control number/i);
    // A preview is not the end of the run, so it must not stamp a finish time.
    expect(run?.finishedAt).toBeUndefined();
  });

  it('commits, writing the mappable row and completing the run', async () => {
    const data = await seedRun('importing');
    const { step } = inlineStep();

    const counts = await fn.handle(event(data), step, 'commit');

    expect(counts.created).toBe(1);
    expect(counts.skipped).toBe(1);
    expect(await mailers.countDocuments({})).toBe(1);

    const mailer = await mailers.findOne({ agencyId: AGENCY_ID }).lean();
    expect(mailer?.controlNumberKeys).toEqual([
      '3F2A91C74D5E4B8A9F109C41B2D70E58',
      '9C41B2D70E58',
    ]);
    expect(mailer?.source?.runId).toBe(data.importRunId);
    expect(mailer?.source?.storageKey).toBe(STORAGE_KEY);

    const run = await runs.findById(data.importRunId).lean();
    expect(run?.status).toBe('completed');
    expect(run?.finishedAt).toBeInstanceOf(Date);
  });

  it('is safe to retry: a second run updates in place rather than duplicating', async () => {
    // This is the property `retries: 2` on the function depends on. A retry
    // re-streams from the start, so without idempotent upserts a run that died
    // halfway would double-write.
    const data = await seedRun('importing');
    await fn.handle(event(data), inlineStep().step, 'commit');
    const second = await fn.handle(event(data), inlineStep().step, 'commit');

    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    expect(await mailers.countDocuments({})).toBe(1);
    expect(storage.reads).toBe(2);
  });

  it('flags an agency mismatch during the preview', async () => {
    // The file says A0B9049; this agency says something else. The flag is
    // written here and read by the commit endpoint, so a client cannot bypass
    // the confirmation by omitting it.
    await agencies.create({
      _id: AGENCY_ID,
      name: 'Northgate Insurance',
      slug: 'northgate-insurance',
      allstateAgencyId: 'B1C2345',
    });
    const data = await seedRun('previewing');

    await fn.handle(event(data), inlineStep().step, 'preview');

    const run = await runs.findById(data.importRunId).lean();
    expect(run?.agencyMismatch).toBe(true);
  });

  it('does not call an absent Allstate id a mismatch', async () => {
    // Nothing to compare is not a disagreement, and a confirmation nobody can
    // act on just trains operators to click through it.
    await agencies.create({
      _id: AGENCY_ID,
      name: 'Smith Family Agency',
      slug: 'smith-family-agency',
    });
    const data = await seedRun('previewing');

    await fn.handle(event(data), inlineStep().step, 'preview');

    expect((await runs.findById(data.importRunId).lean())?.agencyMismatch).toBe(
      false,
    );
  });

  it('records the failure on the run and rethrows so Inngest retries', async () => {
    const data = await seedRun('importing');
    const bad = { ...data, storageKey: 'agencies/x/mailer-imports/gone.csv' };

    await expect(
      fn.handle(event(bad), inlineStep().step, 'commit'),
    ).rejects.toThrow();

    const run = await runs.findById(data.importRunId).lean();
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('unexpected key');
    // A user watching the run sees the outcome either way — it must not sit in
    // `importing` for ever.
    expect(run?.finishedAt).toBeInstanceOf(Date);
  });
});
