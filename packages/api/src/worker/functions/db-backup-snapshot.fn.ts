import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NonRetriableError, cron } from 'inngest';
import {
  DB_BACKUP_SCHEDULE,
  dbBackupAlertEmail,
  dbBackupDumpParallel,
  dbBackupDumpTimeoutMs,
  dbBackupEnabled,
  dbBackupKeep,
} from '../../config/db-backup.config';
import {
  dbBackupSnapshotRequested,
  type DbBackupSnapshotRequestedData,
} from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import {
  ARCHIVE_CONTENT_TYPE,
  SCHEDULED_PREFIX,
  type SnapshotKind,
  buildArchiveKey,
  isScheduledArchiveKey,
  selectKeysToDelete,
} from '../backup/backup-keys';
import { BackupStore } from '../backup/backup-store';
import {
  MongoDumpRunner,
  TEMP_DIR_PREFIX,
  maskUri,
} from '../backup/mongodump-runner';
import {
  MailDeliveryService,
  type SentEmail,
} from '../email/mail-delivery.service';
import type {
  DbBackupFailedData,
  DbBackupFailureStage,
} from '../email/templates/db-backup-failed.template';
import type { DbBackupReportData } from '../email/templates/db-backup-report.template';
import type { StepLike } from './mailer-campaign.support';

/** Three attempts in all. A retry re-runs only the failed step. */
const RETRIES = 2;

/**
 * A single PUT tops out at 5 GiB. Refused a little under it, with a message
 * naming the fix, rather than failing inside the S3 client after a long dump.
 */
const SINGLE_PUT_LIMIT_BYTES = 4.5 * 1024 ** 3;

/** The steps a failure can be attributed to; see {@link inStage}. */
type Stage = Exclude<DbBackupFailureStage, 'request' | 'unknown'>;
const STAGE_PREFIX = /^(plan|snapshot|rotate|notify|record): /;

/** The run this handler is executing, from Inngest's handler context. */
export interface DbBackupRun {
  runId: string | null;
  /** Zero-indexed. */
  attempt: number;
  maxAttempts: number;
}

/**
 * The triggering event: the cron's `inngest/scheduled.timer`, a snapshot
 * request, or the dashboard's `inngest/function.invoked`. `data` is narrowed in
 * {@link requestFrom}.
 */
export interface DbBackupEvent {
  id?: string;
  name: string;
  data?: unknown;
}

/**
 * What `onFailure` receives: Inngest's `inngest/function.failed`, carrying the
 * original event at `data.event`. Structural, like `DataExportFailure`.
 */
export interface DbBackupFailure {
  event: {
    ts?: number;
    data: { run_id: string; event: DbBackupEvent };
  };
  error: Error;
}

export type DbBackupResult =
  | { status: 'disabled' }
  | { status: 'ok'; key: string; bytes: number; deleted: number };

/** Step results. **Strings and numbers only** — see `MailerCampaignCommitFn`. */
interface SnapshotRequest {
  kind: SnapshotKind;
  label: string | null;
}
interface SnapshotPlan extends SnapshotRequest {
  key: string;
  bucket: string;
  toolVersion: string;
}
interface SnapshotResult {
  key: string;
  bytes: number;
  dumpMs: number;
  /** ISO instant the upload finished — the report's timestamp. */
  storedAt: string;
}
interface RotationResult {
  kept: string[];
  deleted: string[];
  skipped: string | null;
  keep: number;
}

/**
 * Snapshot MongoDB to the backup bucket (PAC-172): weekly on a schedule, and on
 * request.
 *
 * ## Why this exists beside DigitalOcean's backups
 * The managed cluster is backed up daily with seven days of point-in-time
 * recovery — but those backups are destroyed with the cluster, and nothing
 * older than a week exists. This is the copy that outlives both. See
 * DEPLOYMENT.md, "Database backups", for the restore runbook.
 *
 * ## Steps
 * 1. **plan** — check the bucket settings and that mongodump is installed, and
 *    mint the archive key. Memoised, so the key is stable across retries: a
 *    retried upload overwrites the same object (a PUT is atomic) instead of
 *    leaving two archives for one week.
 * 2. **snapshot** — dump to a temp file and upload it, in **one** step. In a
 *    pool, a later step can land on a different worker container than the one
 *    holding the file, so the two cannot be split. This step runs for minutes;
 *    the deploy sets `INNGEST_STREAMING` so its response is kept alive through
 *    the internal load balancer (see `inngest-serve.ts`). If the response is
 *    lost anyway, the retry that lands on the same worker **joins** the dump
 *    still running there instead of starting a second one or failing.
 * 3. **rotate** — scheduled runs only: keep one archive per schedule week
 *    (Sunday to Sunday, Pakistan time) for the newest `DB_BACKUP_KEEP` weeks
 *    under `weekly/`, delete the rest (`backup-keys.ts`).
 *    Runs only after the upload succeeded, by step order; never touches another
 *    prefix, a key that is not an archive, or the archive just written. A
 *    re-run of a week replaces that week's earlier archive rather than pushing
 *    an older week out. Requested snapshots are never rotated — the bucket
 *    expires them.
 * 4. **notify** — the report mail, as send + record (the invite split). It
 *    **throws** on failure rather than logging: the weekly mail is the
 *    heartbeat, and a swallowed send would be silence that reads as an outage.
 *    Inngest retries just this step; the dump is memoised, and every value the
 *    mail renders comes from memoised steps, so a retried send carries the
 *    same payload under the same provider idempotency key.
 *
 * Every step's error is prefixed with the step's name, so `onFailure` can tell
 * the reader whether this run stored an archive before it failed.
 *
 * ## Why one function and not one per node
 * A cron fires once per schedule however many worker containers serve it, and
 * `concurrency: 1` keeps a requested snapshot from overlapping the weekly one:
 * two dumps at once would double the load on a one-vCPU cluster. That limit
 * counts executing steps, not runs, so a run waiting out a retry backoff frees
 * its slot; a dump still running here from that run's lost attempt is what
 * {@link DbBackupSnapshotFn.inFlight} queues the next one behind.
 *
 * ## Disabled is not a failure
 * The function is registered everywhere; `DB_BACKUP_ENABLED` decides whether a
 * run does anything. Checked outside any step, so flipping it takes effect on
 * the next tick.
 *
 * ## Import boundary
 * `config/`, `inngest/`, `storage/` and the worker's own modules only — see
 * `eslint.config.mjs`.
 */
@Injectable()
@InngestFunction()
export class DbBackupSnapshotFn implements InngestFunctionProvider {
  private readonly logger = new Logger(DbBackupSnapshotFn.name);

  /**
   * Dumps running in this process, by archive key.
   *
   * The case this exists for: the `snapshot` step's response is lost mid-dump
   * (the connection through the load balancer drops, the Inngest server
   * restarts), but the dump itself carries on. Inngest retries the step within
   * a minute, usually onto the same worker — a one-droplet pool has no other.
   * Starting a second dump would double the load; refusing would spend every
   * retry while the first dump is still minutes from done, and fail a run whose
   * archive is about to land. Joining it does neither: the retry resolves when
   * the dump does, with the same key, and the run carries on to rotate and
   * report. A retry on a *different* worker dumps again; the per-run key makes
   * the second PUT an atomic overwrite with an equally valid archive.
   *
   * A dump for a *different* key — another run that got the concurrency slot
   * while this one waited out a retry backoff — queues behind whatever is in
   * flight here rather than running beside it.
   */
  private readonly inFlight = new Map<string, Promise<SnapshotResult>>();

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly config: ConfigService,
    private readonly dumper: MongoDumpRunner,
    private readonly store: BackupStore,
    private readonly mail: MailDeliveryService,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'db-backup-snapshot',
        name: 'Snapshot MongoDB to object storage',
        /**
         * Sundays 13:00 Pakistan time — 03:00 for the agency. The schedule and
         * why are in `db-backup.config.ts`. Like the other crons, it survives
         * an Inngest that lost its database: registrations come from the
         * function definitions synced at `/api/inngest`.
         */
        triggers: [cron(DB_BACKUP_SCHEDULE), dbBackupSnapshotRequested],
        concurrency: { limit: 1 },
        retries: RETRIES,
        onFailure: (failure: DbBackupFailure) => this.fail(failure),
      },
      ({ event, step, runId, attempt, maxAttempts }) =>
        this.handle(event, step, {
          runId,
          attempt,
          maxAttempts: maxAttempts ?? RETRIES + 1,
        }),
    );
  }

  /** The handler body, lifted out so a test can drive it with a fake `step`. */
  async handle(
    event: DbBackupEvent,
    step: StepLike,
    run: DbBackupRun,
  ): Promise<DbBackupResult> {
    if (!dbBackupEnabled(this.config.get<string>('DB_BACKUP_ENABLED'))) {
      this.logger.log('DB_BACKUP_ENABLED is not "true" — snapshot skipped.');
      return { status: 'disabled' };
    }

    const request = requestFrom(event);

    const plan = (await step.run('plan', () =>
      inStage('plan', () => this.plan(request)),
    )) as SnapshotPlan;

    const snapshot = (await step.run('snapshot', () =>
      inStage('snapshot', () => this.snapshot(plan, run)),
    )) as SnapshotResult;

    const rotation =
      plan.kind === 'scheduled'
        ? ((await step.run('rotate', () =>
            inStage('rotate', () => this.rotate(plan.key)),
          )) as RotationResult)
        : { kept: [], deleted: [], skipped: null, keep: 0 };

    // The cast is sound for the reason `SendInviteEmailFn` gives: a step result
    // round-trips through JSON, and `SentEmail` is all strings.
    const sent = (await step.run('notify-send', () =>
      inStage('notify', () => this.sendReport(plan, snapshot, rotation, run)),
    )) as SentEmail | null;
    if (sent) {
      await step.run('notify-record', () =>
        inStage('record', () =>
          this.mail.record(
            {
              eventId: event.id ?? '',
              eventType: event.name,
              // Platform mail: a snapshot belongs to no tenant.
              agencyId: null,
              branchId: null,
            },
            sent,
          ),
        ),
      );
    }

    return {
      status: 'ok',
      key: snapshot.key,
      bytes: snapshot.bytes,
      deleted: rotation.deleted.length,
    };
  }

  /**
   * The run died or ran out of retries — `onFailure`.
   *
   * Says which step failed, so the reader knows whether this run stored an
   * archive: the step prefix {@link inStage} put on the error, which survives
   * Inngest's serialisation intact. Inngest's own `EventValidationError` — a
   * request it rejected before the handler ran, such as an Invoke or a `curl`
   * without a valid `reason` — is reported as a rejected request; its name
   * survives the round trip too. Anything else without a prefix (a worker that
   * died mid-step, a transport failure) is `unknown`: the dashboard has it.
   *
   * Not wrapped in steps, like `DataExportGenerateFn.fail`: the provider
   * idempotency key collapses a re-sent failure mail, and the payload is
   * stable across retries of this handler (the time comes from the failure
   * event, not the clock).
   */
  async fail(failure: DbBackupFailure): Promise<void> {
    const original = failure.event.data.event;
    const request = requestFrom(original);
    const runId = failure.event.data.run_id;
    const message = failure.error?.message || 'unknown error';
    const tagged = STAGE_PREFIX.exec(message)?.[1] as Stage | undefined;
    const stage: DbBackupFailureStage =
      tagged ??
      (failure.error?.name === 'EventValidationError' ? 'request' : 'unknown');

    this.logger.error(
      `Snapshot run ${runId} (${request.kind}, ${stage}) failed and stopped retrying: ${message}`,
    );

    const to = dbBackupAlertEmail(
      this.config.get<string>('DB_BACKUP_ALERT_EMAIL'),
    );
    if (!to) {
      this.logger.warn(
        'DB_BACKUP_ALERT_EMAIL is not set — nobody was told about this failure.',
      );
      return;
    }

    const data: DbBackupFailedData = {
      to,
      host: this.host(),
      kind: request.kind,
      label: request.label,
      stage,
      bucket: this.store.bucketName,
      runId,
      error: message,
      failedAt: new Date(
        typeof failure.event.ts === 'number' ? failure.event.ts : Date.now(),
      ).toISOString(),
    };
    const sent = await this.mail.send(
      'dbBackupFailed',
      data,
      `db-backup:${runId}:failed`,
      null,
    );
    await this.mail.record(
      {
        eventId: '',
        eventType: 'inngest/function.failed',
        agencyId: null,
        branchId: null,
      },
      sent,
    );
  }

  // -------------------------------------------------------------------------

  /**
   * Fail fast, and without retries, on what a retry cannot fix: a bucket that
   * was never configured, or an image without mongodump.
   */
  private async plan(request: SnapshotRequest): Promise<SnapshotPlan> {
    const missing = this.store.missingSettings();
    if (missing.length > 0) {
      throw new NonRetriableError(
        `Snapshot storage is not configured: set ${missing.join(', ')}.`,
      );
    }

    let toolVersion: string;
    try {
      toolVersion = await this.dumper.version();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NonRetriableError(
          'mongodump is not installed in this image — see the mongodb-tools line in packages/api/Dockerfile.',
        );
      }
      throw error;
    }

    return {
      ...request,
      key: buildArchiveKey(request.kind, new Date(), request.label),
      bucket: this.store.bucketName,
      toolVersion,
    };
  }

  /** Join the dump already running here for this key, or start one. */
  private snapshot(
    plan: SnapshotPlan,
    run: DbBackupRun,
  ): Promise<SnapshotResult> {
    const running = this.inFlight.get(plan.key);
    if (running) {
      this.logger.warn(
        `Snapshot ${plan.key}: attempt ${run.attempt + 1} of ${run.maxAttempts} ` +
          'joined the dump already running in this worker.',
      );
      return running;
    }
    const ahead = [...this.inFlight.values()];
    if (ahead.length > 0) {
      this.logger.warn(
        `Snapshot ${plan.key}: waiting for ${ahead.length} dump(s) still running in this worker.`,
      );
    }
    const attempt = Promise.allSettled(ahead)
      .then(() => this.dumpAndStore(plan, run))
      .finally(() => {
        this.inFlight.delete(plan.key);
      });
    this.inFlight.set(plan.key, attempt);
    return attempt;
  }

  private async dumpAndStore(
    plan: SnapshotPlan,
    run: DbBackupRun,
  ): Promise<SnapshotResult> {
    const uri = this.config.get<string>('MONGODB_URI');
    if (!uri) {
      throw new NonRetriableError(
        'MONGODB_URI is not set — there is nothing to snapshot.',
      );
    }

    await this.dumper.sweepStaleTempDirs();
    const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
    try {
      const archivePath = join(dir, 'dump.archive.gz');
      this.logger.log(
        `Snapshot ${plan.key}: dumping ${maskUri(uri)} ` +
          `(attempt ${run.attempt + 1} of ${run.maxAttempts}).`,
      );

      const { durationMs } = await this.dumper.run({
        uri,
        dir,
        archivePath,
        timeoutMs: dbBackupDumpTimeoutMs(
          this.config.get<string>('DB_BACKUP_DUMP_TIMEOUT_MINUTES'),
        ),
        numParallelCollections: dbBackupDumpParallel(
          this.config.get<string>('DB_BACKUP_DUMP_PARALLEL'),
        ),
      });

      const { size } = await stat(archivePath);
      if (size === 0) {
        throw new Error('mongodump exited cleanly but wrote an empty archive.');
      }
      if (size > SINGLE_PUT_LIMIT_BYTES) {
        throw new NonRetriableError(
          `The archive is ${size} bytes, past what one PUT can store. ` +
            'BackupStore.putFile needs a multipart upload (@aws-sdk/lib-storage).',
        );
      }

      await this.store.putFile(plan.key, archivePath, ARCHIVE_CONTENT_TYPE);
      this.logger.log(
        `Snapshot ${plan.key}: stored ${size} bytes in ${plan.bucket} ` +
          `(dump took ${Math.round(durationMs / 1000)}s).`,
      );
      return {
        key: plan.key,
        bytes: size,
        dumpMs: durationMs,
        storedAt: new Date().toISOString(),
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async rotate(currentKey: string): Promise<RotationResult> {
    const keep = dbBackupKeep(this.config.get<string>('DB_BACKUP_KEEP'));
    const keys = await this.store.list(SCHEDULED_PREFIX);

    // A listing that does not show the archive we just wrote is a listing we
    // do not trust to decide deletions. Deleting nothing is always safe; the
    // next run catches up.
    if (!keys.includes(currentKey)) {
      this.logger.warn(
        `Rotation skipped: ${currentKey} is missing from a listing of ` +
          `${keys.length} key(s) under ${SCHEDULED_PREFIX}.`,
      );
      return {
        kept: newestFirst(keys),
        deleted: [],
        skipped: 'the archive just written was not in the bucket listing',
        keep,
      };
    }

    const doomed = selectKeysToDelete(keys, keep, { protect: currentKey });
    for (const key of doomed) {
      await this.store.deleteObject(key);
    }
    const kept = newestFirst(keys.filter((key) => !doomed.includes(key)));
    this.logger.log(
      `Rotation kept ${kept.length} weekly archive(s), deleted ` +
        `${doomed.length}${doomed.length ? `: ${doomed.join(', ')}` : ''}.`,
    );
    return { kept, deleted: doomed, skipped: null, keep };
  }

  /**
   * Every value here comes from a memoised step result or the run's settings,
   * never the clock: a retried send must carry the same payload under the same
   * idempotency key, or the provider refuses it as a conflicting reuse.
   */
  private async sendReport(
    plan: SnapshotPlan,
    snapshot: SnapshotResult,
    rotation: RotationResult,
    run: DbBackupRun,
  ): Promise<SentEmail | null> {
    const to = dbBackupAlertEmail(
      this.config.get<string>('DB_BACKUP_ALERT_EMAIL'),
    );
    if (!to) {
      this.logger.warn(
        'DB_BACKUP_ALERT_EMAIL is not set — the snapshot report was only logged.',
      );
      return null;
    }

    const data: DbBackupReportData = {
      to,
      host: this.host(),
      kind: plan.kind,
      label: plan.label,
      bucket: plan.bucket,
      key: snapshot.key,
      bytes: snapshot.bytes,
      dumpSeconds: Math.round(snapshot.dumpMs / 1000),
      toolVersion: plan.toolVersion,
      kept: rotation.kept,
      deleted: rotation.deleted,
      rotationSkipped: rotation.skipped,
      keep: rotation.keep,
      finishedAt: snapshot.storedAt,
    };
    return this.mail.send(
      'dbBackupReport',
      data,
      // One report per run. The key is the fallback only for a test harness
      // with no run id; it is unique per run all the same.
      `db-backup:${run.runId ?? snapshot.key}:ok`,
      null,
    );
  }

  /** Which environment a mail is about — the hostname an operator knows it by. */
  private host(): string {
    return this.config.get<string>('PLATFORM_HOST')?.trim() || 'unknown host';
  }
}

/**
 * What a run was asked for, read from the event's `data` rather than its name.
 *
 * Two events can carry a request: `db-backup/snapshot.requested.v1`, and the
 * dashboard's **Invoke**, which arrives as `inngest/function.invoked` with the
 * same data. Keying off the name would file an invoked manual snapshot under
 * `weekly/`, where rotation would count it.
 *
 * Only the cron's timer event carries no `reason`: Inngest validates every
 * other event — an Invoke included — against the request schema before this
 * handler runs, so a request without a `reason` fails there instead of
 * arriving here. A dashboard **Rerun** of a weekly run does start again from
 * the timer event and so is a scheduled snapshot; rotation's one-per-week rule
 * makes it replace that week's archive rather than push an older week out.
 */
function requestFrom(event: DbBackupEvent): SnapshotRequest {
  const data = (event.data ?? {}) as Partial<DbBackupSnapshotRequestedData>;
  if (data.reason === 'manual' || data.reason === 'pre-deploy') {
    return { kind: data.reason, label: data.label ?? null };
  }
  return { kind: 'scheduled', label: null };
}

/**
 * Run a step's body, prefixing any error with the step's name — what `fail()`
 * reads to say whether the run stored an archive before it failed. A
 * `NonRetriableError` stays one, so the prefix never changes retry behaviour.
 */
async function inStage<T>(stage: Stage, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const message = `${stage}: ${error instanceof Error ? error.message : String(error)}`;
    if (error instanceof NonRetriableError) {
      throw new NonRetriableError(message, { cause: error });
    }
    throw new Error(message, { cause: error });
  }
}

function newestFirst(keys: string[]): string[] {
  return keys.filter(isScheduledArchiveKey).sort().reverse();
}
