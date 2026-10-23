import { readdirSync } from 'fs';
import { stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { NonRetriableError } from 'inngest';
import type { Model } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { buildArchiveKey } from '../../src/worker/backup/backup-keys';
import { BackupStore } from '../../src/worker/backup/backup-store';
import {
  MongoDumpRunner,
  TEMP_DIR_PREFIX,
  type MongoDumpOptions,
} from '../../src/worker/backup/mongodump-runner';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from '../../src/worker/email/mail-transport';
import { EmailMessage } from '../../src/worker/email/schemas/email-message.schema';
import {
  DbBackupSnapshotFn,
  type DbBackupRun,
} from '../../src/worker/functions/db-backup-snapshot.fn';
import { WorkerModule } from '../../src/worker/worker.module';
import { inlineStep } from '../helpers/inline-step';

/**
 * The weekly MongoDB snapshot (PAC-172), driven through `handle()` and
 * `fail()` with the dump and the bucket faked.
 *
 * What is real: the function, its steps and their order, the rotation it
 * applies, the temp-file handling, the report mails and their delivery records.
 * What is not: mongodump (`mongodump-runner.unit-spec.ts` covers its arguments,
 * and the rollout checklist runs it for real) and the bucket.
 *
 * Booting `WorkerModule` on its own is an assertion too — see
 * `materialize-renewal-cycles.e2e-spec.ts`.
 */

/** Records what would have been mailed. */
class CaptureMailTransport extends MailTransport {
  readonly sent: Array<{ message: OutboundMessage; idempotencyKey: string }> =
    [];
  failWith: Error | null = null;

  send(message: OutboundMessage, idempotencyKey: string): Promise<SendResult> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push({ message, idempotencyKey });
    return Promise.resolve({
      providerMessageId: `capture-${this.sent.length}`,
    });
  }
}

/** Writes a fixed number of bytes where mongodump would have written the archive. */
class FakeMongoDumpRunner {
  readonly calls: MongoDumpOptions[] = [];
  bytes = 1234;
  failWith: Error | null = null;
  versionError: Error | null = null;

  version(): Promise<string> {
    if (this.versionError) return Promise.reject(this.versionError);
    return Promise.resolve('mongodump version: 100.14.1');
  }

  async run(options: MongoDumpOptions): Promise<{ durationMs: number }> {
    this.calls.push(options);
    if (this.failWith) throw this.failWith;
    await writeFile(options.archivePath, Buffer.alloc(this.bytes, 7));
    return { durationMs: 42_000 };
  }

  sweepStaleTempDirs(): Promise<void> {
    return Promise.resolve();
  }

  reset(): void {
    this.calls.length = 0;
    this.bytes = 1234;
    this.failWith = null;
    this.versionError = null;
  }
}

/**
 * The snapshot bucket, in a `Map`.
 *
 * Same idea as `FakeStorage`: the suite is about which keys get written and
 * which get deleted, and a real bucket would make it fail on any machine that
 * has not started MinIO, for no extra coverage. Here rather than in
 * `test/helpers/`, because only `test/worker/` may import from `src/worker/`.
 */
class FakeBackupStore {
  readonly objects = new Map<string, { size: number; contentType: string }>();
  readonly bucketName = 'sfa-test-db-backups';
  /** Settings to report as unset — `[]` means configured. */
  missing: string[] = [];
  /**
   * Keys `list()` should not return, to stand in for a listing that lags a
   * write. `null` lists everything.
   */
  hideFromListing: ((key: string) => boolean) | null = null;

  missingSettings(): string[] {
    return [...this.missing];
  }

  async putFile(key: string, path: string, contentType: string) {
    const { size } = await stat(path);
    this.objects.set(key, { size, contentType });
    return { key, size };
  }

  list(prefix: string): Promise<string[]> {
    return Promise.resolve(
      [...this.objects.keys()].filter(
        (key) => key.startsWith(prefix) && !this.hideFromListing?.(key),
      ),
    );
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Put an object in place as if an earlier run had written it. */
  seed(key: string, size = 10): void {
    this.objects.set(key, { size, contentType: 'application/gzip' });
  }

  reset(): void {
    this.objects.clear();
    this.missing = [];
    this.hideFromListing = null;
  }

  /** The provider value, typed as the real service for the DI override. */
  asService(): BackupStore {
    return this as unknown as BackupStore;
  }
}

const CRON_EVENT = {
  id: 'evt-cron',
  name: 'inngest/scheduled.timer',
  data: { cron: 'TZ=Asia/Karachi 0 13 * * 0' },
};
const MANUAL_EVENT = {
  id: 'evt-manual',
  name: 'db-backup/snapshot.requested.v1',
  data: { reason: 'manual', label: 'Before PAC-180' },
};
const RUN: DbBackupRun = { runId: 'run-1', attempt: 0, maxAttempts: 3 };

const SCHEDULED_KEY = /^weekly\/\d{8}T\d{6}Z\.archive\.gz$/;
const weekly = (iso: string) => buildArchiveKey('scheduled', new Date(iso));

/** The env this suite sets, restored afterwards: `--runInBand` shares one process. */
const ENV_KEYS = [
  'DB_BACKUP_ENABLED',
  'DB_BACKUP_ALERT_EMAIL',
  'DB_BACKUP_KEEP',
] as const;

function strayTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) =>
    name.startsWith(TEMP_DIR_PREFIX),
  );
}

describe('DbBackupSnapshotFn (e2e)', () => {
  let app: INestApplication;
  let fn: DbBackupSnapshotFn;
  let messages: Model<EmailMessage>;
  const mail = new CaptureMailTransport();
  const dumper = new FakeMongoDumpRunner();
  const store = new FakeBackupStore();
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeAll(async () => {
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
      .overrideProvider(MailTransport)
      .useValue(mail)
      .overrideProvider(MongoDumpRunner)
      .useValue(dumper)
      .overrideProvider(BackupStore)
      .useValue(store.asService())
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    fn = app.get(DbBackupSnapshotFn);
    messages = app.get<Model<EmailMessage>>(getModelToken(EmailMessage.name));
  });

  afterAll(async () => {
    await messages.deleteMany({
      templateKey: { $in: ['dbBackupReport', 'dbBackupFailed'] },
    });
    await app.close();
  });

  beforeEach(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.DB_BACKUP_ENABLED = 'true';
    process.env.DB_BACKUP_ALERT_EMAIL = 'ops@example.com';
    delete process.env.DB_BACKUP_KEEP;

    mail.sent.length = 0;
    mail.failWith = null;
    dumper.reset();
    store.reset();
    await messages.deleteMany({
      templateKey: { $in: ['dbBackupReport', 'dbBackupFailed'] },
    });
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('does nothing when DB_BACKUP_ENABLED is not true', async () => {
    process.env.DB_BACKUP_ENABLED = 'false';
    const { ran, step } = inlineStep();

    await expect(fn.handle(CRON_EVENT, step, RUN)).resolves.toEqual({
      status: 'disabled',
    });
    expect(ran).toEqual([]);
    expect(dumper.calls).toHaveLength(0);
    expect(store.objects.size).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('stores a weekly archive, reports it, and records the mail', async () => {
    const before = strayTempDirs();
    const { ran, step } = inlineStep();

    const result = await fn.handle(CRON_EVENT, step, RUN);

    expect(ran).toEqual([
      'plan',
      'snapshot',
      'rotate',
      'notify-send',
      'notify-record',
    ]);
    const keys = [...store.objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(SCHEDULED_KEY);
    expect(store.objects.get(keys[0])).toEqual({
      size: 1234,
      contentType: 'application/gzip',
    });
    expect(result).toEqual({
      status: 'ok',
      key: keys[0],
      bytes: 1234,
      deleted: 0,
    });

    // The dump was asked for the configured database, with the defaults.
    expect(dumper.calls[0].uri).toBe(process.env.MONGODB_URI);
    expect(dumper.calls[0].numParallelCollections).toBe(2);
    expect(dumper.calls[0].timeoutMs).toBe(45 * 60_000);
    // ...and its scratch directory is gone.
    expect(strayTempDirs()).toEqual(before);

    expect(mail.sent).toHaveLength(1);
    const [{ message, idempotencyKey }] = mail.sent;
    expect(message.to).toBe('ops@example.com');
    expect(message.subject).toContain('Weekly DB backup OK');
    expect(message.text).toContain(`sfa-test-db-backups/${keys[0]}`);
    expect(message.text).toContain('1.2 KB');
    expect(idempotencyKey).toBe('db-backup:run-1:ok');

    const rows = await messages.find({ templateKey: 'dbBackupReport' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].agencyId).toBeNull();
  });

  it('keeps the newest four weekly archives and touches nothing else', async () => {
    const old = [
      weekly('2026-09-20T08:00:00Z'),
      weekly('2026-09-27T08:00:00Z'),
      weekly('2026-10-04T08:00:00Z'),
      weekly('2026-10-11T08:00:00Z'),
      weekly('2026-10-18T08:00:00Z'),
    ];
    old.forEach((key) => store.seed(key));
    store.seed('weekly/README.txt');
    store.seed('manual/20250101T000000Z-ancient.archive.gz');
    const { step } = inlineStep();

    const result = await fn.handle(CRON_EVENT, step, RUN);

    // Five old + the new one = six; four survive, the two oldest go.
    expect(result).toMatchObject({ status: 'ok', deleted: 2 });
    expect(store.objects.has(old[0])).toBe(false);
    expect(store.objects.has(old[1])).toBe(false);
    for (const key of old.slice(2)) expect(store.objects.has(key)).toBe(true);
    expect(store.objects.has((result as { key: string }).key)).toBe(true);
    expect(store.objects.has('weekly/README.txt')).toBe(true);
    expect(
      store.objects.has('manual/20250101T000000Z-ancient.archive.gz'),
    ).toBe(true);

    const { text } = mail.sent[0].message;
    expect(text).toContain('kept (4 of 4)');
    expect(text).toContain(old[0]);
    expect(text).toContain(old[1]);
  });

  it('honours DB_BACKUP_KEEP', async () => {
    process.env.DB_BACKUP_KEEP = '1';
    store.seed(weekly('2026-10-11T08:00:00Z'));
    store.seed(weekly('2026-10-18T08:00:00Z'));
    const { step } = inlineStep();

    const result = await fn.handle(CRON_EVENT, step, RUN);

    expect([...store.objects.keys()]).toEqual([
      (result as { key: string }).key,
    ]);
  });

  /** A listing we cannot see our own write in is not one to delete from. */
  it('deletes nothing when the listing does not show the new archive', async () => {
    const seeded = [
      weekly('2026-09-20T08:00:00Z'),
      weekly('2026-09-27T08:00:00Z'),
      weekly('2026-10-04T08:00:00Z'),
      weekly('2026-10-11T08:00:00Z'),
      weekly('2026-10-18T08:00:00Z'),
    ];
    seeded.forEach((key) => store.seed(key));
    store.hideFromListing = (key) => !seeded.includes(key);
    const { step } = inlineStep();

    const result = await fn.handle(CRON_EVENT, step, RUN);

    expect(result).toMatchObject({ status: 'ok', deleted: 0 });
    for (const key of seeded) expect(store.objects.has(key)).toBe(true);
    expect(mail.sent[0].message.text).toContain(
      'Rotation deleted nothing this week',
    );
  });

  it('stores a requested snapshot under its reason and never rotates', async () => {
    const seeded = [
      weekly('2026-09-20T08:00:00Z'),
      weekly('2026-09-27T08:00:00Z'),
      weekly('2026-10-04T08:00:00Z'),
      weekly('2026-10-11T08:00:00Z'),
      weekly('2026-10-18T08:00:00Z'),
    ];
    seeded.forEach((key) => store.seed(key));
    const { ran, step } = inlineStep();

    const result = await fn.handle(MANUAL_EVENT, step, RUN);

    expect(ran).not.toContain('rotate');
    expect((result as { key: string }).key).toMatch(
      /^manual\/\d{8}T\d{6}Z-before-pac-180\.archive\.gz$/,
    );
    for (const key of seeded) expect(store.objects.has(key)).toBe(true);
    expect(mail.sent[0].message.subject).toContain('Manual DB snapshot OK');
  });

  /** The dashboard's Invoke button sends this name, with the request's data. */
  it('treats an Invoke carrying a reason as that request', async () => {
    const { ran, step } = inlineStep();

    const result = await fn.handle(
      {
        name: 'inngest/function.invoked',
        data: { reason: 'manual', label: 'from-dashboard' },
      },
      step,
      RUN,
    );

    expect(ran).not.toContain('rotate');
    expect((result as { key: string }).key).toMatch(
      /^manual\/\d{8}T\d{6}Z-from-dashboard\.archive\.gz$/,
    );
  });

  it('names a pre-deploy snapshot after its commit', async () => {
    const { step } = inlineStep();

    const result = await fn.handle(
      {
        name: 'db-backup/snapshot.requested.v1',
        data: { reason: 'pre-deploy', label: '3f9c2ab' },
      },
      step,
      RUN,
    );

    expect((result as { key: string }).key).toMatch(
      /^pre-deploy\/\d{8}T\d{6}Z-3f9c2ab\.archive\.gz$/,
    );
  });

  it('fails a dump without storing, mailing or leaving files behind', async () => {
    const before = strayTempDirs();
    dumper.failWith = new Error('mongodump exited with code 1: boom');
    const { step } = inlineStep();

    await expect(fn.handle(CRON_EVENT, step, RUN)).rejects.toThrow('boom');

    expect(store.objects.size).toBe(0);
    expect(mail.sent).toHaveLength(0);
    expect(strayTempDirs()).toEqual(before);
  });

  it('mails the failure once retries are exhausted', async () => {
    await fn.fail({
      event: { data: { run_id: 'run-9', event: CRON_EVENT } },
      error: new Error('mongodump exited with code 1: boom'),
    });

    expect(mail.sent).toHaveLength(1);
    const [{ message, idempotencyKey }] = mail.sent;
    expect(message.subject).toMatch(/^DB backup FAILED/);
    expect(message.text).toContain('weekly database snapshot');
    expect(message.text).toContain('run-9');
    expect(message.text).toContain('boom');
    expect(idempotencyKey).toBe('db-backup:run-9:failed');

    const rows = await messages.find({ templateKey: 'dbBackupFailed' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].agencyId).toBeNull();
  });

  it('refuses to dump, without retrying, when the bucket is not configured', async () => {
    store.missing = ['DB_BACKUP_STORAGE_BUCKET'];
    const { step } = inlineStep();

    const run = fn.handle(CRON_EVENT, step, RUN);

    await expect(run).rejects.toBeInstanceOf(NonRetriableError);
    await expect(run).rejects.toThrow('DB_BACKUP_STORAGE_BUCKET');
    expect(dumper.calls).toHaveLength(0);
  });

  it('refuses, without retrying, when mongodump is not installed', async () => {
    dumper.versionError = Object.assign(new Error('spawn mongodump ENOENT'), {
      code: 'ENOENT',
    });
    const { step } = inlineStep();

    await expect(fn.handle(CRON_EVENT, step, RUN)).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    expect(dumper.calls).toHaveLength(0);
  });

  /** The weekly mail is the heartbeat; a lost send must fail the run, not vanish. */
  it('fails the run when the report cannot be sent, keeping the archive', async () => {
    mail.failWith = new Error('Resend is down');
    const { step } = inlineStep();

    await expect(fn.handle(CRON_EVENT, step, RUN)).rejects.toThrow(
      'Resend is down',
    );
    expect(store.objects.size).toBe(1);
  });
});
