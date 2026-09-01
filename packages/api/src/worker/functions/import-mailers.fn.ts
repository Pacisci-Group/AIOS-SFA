import { pipeline } from 'stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { parse } from 'csv-parse';
import { Model } from 'mongoose';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  mailerImportCommitRequested,
  mailerImportPreviewRequested,
  type MailerImportRequestedData,
} from '../../inngest/events';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import { StorageService } from '../../storage/storage.service';
import {
  importMailerRows,
  type MailerImportResult,
} from '../../common/mailers/mailer-import';
import { normalizeHeader } from '../../common/mailers/mailer-row.mapper';
import {
  Mailer,
  type MailerDocument,
} from '../../mailers/schemas/mailer.schema';
import {
  MailerImportRun,
  type MailerImportRunDocument,
} from '../../mailers/schemas/mailer-import-run.schema';
import {
  Agency,
  type AgencyDocument,
} from '../../platform/schemas/agency.schema';

/** What a run is doing. Selects the terminal status and whether it writes. */
type ImportPhase = 'preview' | 'commit';

/**
 * Parse an uploaded mailer file and, on commit, write the mailers (PAC-73).
 *
 * ## Why this is a worker job rather than a request
 *
 * The reference file is 23 MB / 20,405 rows, which a request could just about
 * survive; the BigQuery history is 671,339. Doing it here means the size of the
 * file stops being coupled to an HTTP timeout, and the operator gets a run they
 * can watch instead of a spinner they have to keep open. The trade is a run
 * record to poll — `MailerImportRun` — which the report needed anyway.
 *
 * ## Two functions, one handler
 *
 * Preview and commit differ only in whether they write; keeping one handler is
 * what guarantees the operator's preview describes exactly what the commit will
 * do. They are separate *functions* because they are separately triggered and
 * separately gated — see `mailer.events.ts`.
 *
 * ## Import boundary
 *
 * This file may import `*.schema.ts` and the pure helpers in `common/`, but no
 * feature service — see `eslint.config.mjs`. That is why the whole import
 * engine is a plain function taking its model as an argument
 * (`common/mailers/mailer-import.ts`) rather than an `@Injectable`, and it is
 * also what lets the BigQuery backfill CLI reuse it verbatim.
 */
@Injectable()
@InngestFunction()
export class ImportMailersFn implements InngestFunctionProvider {
  private readonly logger = new Logger(ImportMailersFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly storage: StorageService,
    @InjectModel(Mailer.name)
    private readonly mailerModel: Model<MailerDocument>,
    @InjectModel(MailerImportRun.name)
    private readonly runModel: Model<MailerImportRunDocument>,
    // Schemas may cross the worker boundary; services may not. `Agency` is
    // needed only to read the ticker/Allstate id for the cross-check.
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
  ) {}

  build() {
    /**
     * Shared config.
     *
     * - `idempotency` on the run id: a double-submitted commit imports once.
     *   Safe to key on because a run is created per upload and never reused.
     * - `concurrency` keyed on the agency: two uploads for one agency would
     *   otherwise interleave their `bulkWrite`s over the same dedupe keys.
     *   Different agencies still run in parallel.
     * - `retries: 2`. A retry re-streams from the start, which is **only** safe
     *   because every write is an upsert on the dedupe key — a partially
     *   completed run converges rather than duplicating. Do not raise this
     *   without keeping that property.
     */
    const shared = {
      idempotency: 'event.data.importRunId',
      concurrency: { limit: 1, key: 'event.data.agencyId' },
      retries: 2,
    } as const;

    return [
      this.inngest.createFunction(
        {
          ...shared,
          id: 'mailer-import-preview',
          name: 'Preview a mailer import',
          triggers: [mailerImportPreviewRequested],
        },
        ({ event, step }) => this.handle(event, step, 'preview'),
      ),
      this.inngest.createFunction(
        {
          ...shared,
          id: 'mailer-import-commit',
          name: 'Commit a mailer import',
          triggers: [mailerImportCommitRequested],
        },
        ({ event, step }) => this.handle(event, step, 'commit'),
      ),
    ];
  }

  /**
   * The handler body, lifted out of `createFunction` so it can be called
   * directly — the same seam `SendInviteEmailFn` uses. A handler written inline
   * is only reachable by standing up a real Inngest server, which tests the
   * platform rather than our code.
   */
  async handle(
    event: { id?: string; name: string; data: MailerImportRequestedData },
    step: StepLike,
    phase: ImportPhase,
  ): Promise<{
    read: number;
    created: number;
    updated: number;
    skipped: number;
  }> {
    const { importRunId, agencyId, storageKey, requestedBy } = event.data;

    // One step, deliberately. The import is internally idempotent, so there is
    // nothing to protect with a memoized boundary — and splitting it per batch
    // would memoize twenty results that a retry would have re-derived
    // identically anyway. Returns plain counts because a step's return value is
    // serialised to JSON and re-parsed before anything else sees it.
    const counts = await step.run('import', async () => {
      await this.runModel.updateOne(
        { _id: importRunId },
        { $set: { status: phase === 'preview' ? 'previewing' : 'importing' } },
      );

      try {
        const result = await this.parseAndImport({
          agencyId,
          storageKey,
          requestedBy,
          importRunId,
          phase,
        });
        await this.recordSuccess(importRunId, phase, result);
        return result.counts;
      } catch (error) {
        const message = (error as Error).message;
        this.logger.error(
          `Mailer import ${phase} failed for run ${importRunId}: ${message}`,
        );
        await this.runModel.updateOne(
          { _id: importRunId },
          {
            $set: { status: 'failed', error: message, finishedAt: new Date() },
          },
        );
        // Rethrow so Inngest records the failure and retries. The run record is
        // already `failed`, so a user watching it sees the outcome either way.
        throw error;
      }
    });

    return counts as {
      read: number;
      created: number;
      updated: number;
      skipped: number;
    };
  }

  /** Stream the object, parse it as CSV, and hand rows to the shared engine. */
  private async parseAndImport(input: {
    agencyId: string;
    storageKey: string;
    requestedBy: string;
    importRunId: string;
    phase: ImportPhase;
  }): Promise<MailerImportResult> {
    const run = await this.runModel
      .findById(input.importRunId)
      .select({ uploadedFilename: 1 })
      .lean();

    const body = await this.storage.getObjectStream(input.storageKey);

    // `columns` receives the raw header row and returns the keys every record
    // is built with — so normalization happens once, at the boundary, and the
    // mapper never sees a source-specific spelling.
    const parser = parse({
      bom: true,
      columns: (header: string[]) => header.map(normalizeHeader),
      skipEmptyLines: true,
      // A trailing short row in a hand-trimmed file is a fixture artifact, not
      // a reason to abort an import of 20,405 good ones.
      relaxColumnCount: true,
      trim: true,
    });

    // `pipeline`, **never** `body.pipe(parser)`.
    //
    // `pipe()` does not forward a source error to its destination. When object
    // storage aborted the response mid-file — which it does to any client that
    // stops reading for ~30s, and a slow write batch is exactly that — the
    // parser was told nothing at all: no `error`, no `end`. The `for await` in
    // `importMailerRows` then waited on a row that could never arrive, so the
    // step never settled, the `catch` below never ran, the run stayed
    // `importing` for ever and `retries` never engaged. A job that hangs is
    // strictly worse than one that fails, because nothing downstream can see it.
    //
    // `pipeline` destroys both streams with the error, so the same abort now
    // surfaces as a throw the handler records and Inngest retries. The retry is
    // safe because every write is an upsert on the dedupe key.
    //
    // Fired and not awaited on purpose: the returned promise settles only once
    // the parser is fully consumed, which is what `importMailerRows` is doing
    // below. Awaiting it here would deadlock. The `catch` is what keeps a
    // rejection from surfacing as an unhandled rejection in the race where
    // `pipeline` rejects fractionally before the consumer observes the
    // destroyed parser — the consumer is what actually reports the failure.
    pipeline(body, parser).catch(() => undefined);

    return importMailerRows(
      parser,
      {
        agencyId: input.agencyId,
        system: 'spreadsheet',
        runId: input.importRunId,
        uploadedFilename: run?.uploadedFilename,
        storageKey: input.storageKey,
        uploadedAt: new Date(),
        updatedBy: input.requestedBy,
      },
      { model: this.mailerModel },
      { dryRun: input.phase === 'preview' },
    );
  }

  private async recordSuccess(
    importRunId: string,
    phase: ImportPhase,
    result: MailerImportResult,
  ): Promise<void> {
    if (result.inconsistentColumns.length > 0) {
      // Not fatal — a second value is a reason to look at the file, not to
      // refuse it — but it undermines the per-upload agency choice, so it must
      // not pass silently.
      this.logger.warn(
        `Mailer import ${importRunId}: columns expected to be single-valued ` +
          `across the file were not: ${result.inconsistentColumns.join(', ')}.`,
      );
    }

    await this.runModel.updateOne(
      { _id: importRunId },
      {
        $set: {
          status: phase === 'preview' ? 'previewed' : 'completed',
          counts: result.counts,
          rejections: result.rejections,
          ...(result.detected ? { detected: result.detected } : {}),
          ...(phase === 'preview'
            ? { agencyMismatch: await this.detectMismatch(importRunId, result) }
            : {}),
          ...(phase === 'commit' ? { finishedAt: new Date() } : {}),
        },
      },
    );
  }

  /**
   * Does the file's own `agencyid` disagree with the agency the operator chose?
   *
   * Written during the preview and read by the commit endpoint, so the
   * confirmation cannot be bypassed by a client that simply omits it — filing
   * one agency's prospects under another is the failure that matters here.
   *
   * ⚠ Absence is **not** a mismatch. An agency with no `allstateAgencyId` on
   * record, or a file with no `agencyid` column, means we have nothing to
   * compare — and blocking every upload behind a confirmation nobody can act on
   * would train operators to click through it, which is worse than not asking.
   */
  private async detectMismatch(
    importRunId: string,
    result: MailerImportResult,
  ): Promise<boolean> {
    const fileAgencyId = result.detected?.agencyId;
    if (!fileAgencyId) return false;

    const run = await this.runModel
      .findById(importRunId)
      .select({ agencyId: 1 })
      .lean();
    if (!run) return false;

    const agency = await this.agencyModel
      .findById(run.agencyId)
      .select({ allstateAgencyId: 1 })
      .lean();
    if (!agency?.allstateAgencyId) return false;

    return agency.allstateAgencyId.toUpperCase() !== fileAgencyId.toUpperCase();
  }
}

/**
 * The slice of Inngest's step tooling this handler uses.
 *
 * Narrow on purpose: it is the seam a test substitutes, and depending on the
 * full step API would make that substitution a chore for no benefit.
 */
interface StepLike {
  // Returns `unknown` rather than `T` because Inngest returns `Jsonify<T>`.
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}
