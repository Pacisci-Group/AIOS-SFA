import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { MailerImportRun as MailerImportRunDto } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { InngestService } from '../inngest/inngest.service';
import {
  mailerImportCommitRequested,
  mailerImportPreviewRequested,
} from '../inngest/events';
import { Agency, type AgencyDocument } from '../platform/schemas/agency.schema';
import { StorageService } from '../storage/storage.service';
import {
  CANONICAL_MAILER_CONTENT_TYPE,
  type CommitMailerImportDto,
  type CreateMailerImportDto,
  type PresignMailerImportDto,
} from './dto/mailer-import.dto';
import {
  MailerImportRun,
  type MailerImportRunDocument,
} from './schemas/mailer-import-run.schema';

/**
 * Object-key namespace for uploaded mailer files.
 *
 * Fixed segment, because `StorageService.assertKeyOwnership` treats the
 * `agencies/<id>/<purpose>/` prefix as a security property: a client hands back
 * the key it was given, so without an exact prefix test it could hand back any
 * key it knew of — including another agency's object — and have it imported
 * into its own tenant.
 */
const MAILER_IMPORT_PURPOSE = 'mailer-imports';

/**
 * The Super Admin side of mailer imports (PAC-73).
 *
 * Owns the request-bound half only: presign, create a run, gate the commit,
 * report. The parsing and the writing happen in the worker
 * (`src/worker/functions/import-mailers.fn.ts`), because a 23 MB file is not
 * something to hold an HTTP request open for and the BigQuery history is 30×
 * larger again.
 *
 * ## Why this service is thin on purpose
 *
 * PAC-71 replaces Add Mailers with Mailer Campaigns and this goes away. The
 * import engine deliberately does not live here — it is a plain function in
 * `common/mailers/` that the worker, the BigQuery CLI and PAC-71 all call — so
 * removing this file is a deletion rather than an unpicking.
 */
@Injectable()
export class PlatformMailersService {
  constructor(
    @InjectModel(MailerImportRun.name)
    private readonly runModel: Model<MailerImportRunDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    private readonly storage: StorageService,
    private readonly inngest: InngestService,
  ) {}

  /** A short-lived PUT URL so the file bytes never pass through the API. */
  async presignUpload(dto: PresignMailerImportDto) {
    await this.assertAgencyExists(dto.agencyId);

    const key = this.storage.buildObjectKey({
      agencyId: dto.agencyId,
      purpose: MAILER_IMPORT_PURPOSE,
      filename: dto.filename,
    });

    // Signed with the canonical type regardless of what the browser reported,
    // and echoed back in `requiredHeaders` so the client sends exactly this.
    return this.storage.createPresignedUpload(
      key,
      CANONICAL_MAILER_CONTENT_TYPE,
    );
  }

  /**
   * Record the upload and start the preview parse.
   *
   * Nothing is written to `mailers` here or by the job this starts — the
   * operator sees what the file contains before deciding.
   */
  async createImport(
    dto: CreateMailerImportDto,
    requestedBy: string,
  ): Promise<MailerImportRunDto> {
    await this.assertAgencyExists(dto.agencyId);
    this.storage.assertKeyOwnership(dto.key, {
      agencyId: dto.agencyId,
      purpose: MAILER_IMPORT_PURPOSE,
    });

    // `HeadObject` is the only server-side evidence of what was really stored.
    // A presigned PUT signs only `Content-Type`, so a declared size validates
    // the client's claim rather than the object — and an absent object here
    // means a presign whose upload never completed.
    const stat = await this.storage.statObject(dto.key);
    if (!stat) {
      throw new BadRequestException(
        'The uploaded file was not found in storage. Please upload it again.',
      );
    }
    if (stat.size === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }

    const run = await this.runModel.create({
      agencyId: dto.agencyId,
      storageKey: dto.key,
      uploadedFilename: dto.filename,
      contentType: stat.contentType ?? undefined,
      sizeBytes: stat.size,
      status: 'previewing',
      requestedBy,
    });

    await this.inngest.send(mailerImportPreviewRequested, {
      importRunId: run._id.toString(),
      agencyId: dto.agencyId,
      storageKey: dto.key,
      requestedBy,
    });

    return this.toDto(run);
  }

  /** The poll target while a run is working, and the report once it is done. */
  async getImport(runId: string): Promise<MailerImportRunDto> {
    const run = await this.findRun(runId);
    const dto = this.toDto(run);

    // Presigned URLs expire, so the link is minted per read rather than stored
    // on the run — a report left open for ten minutes would hand out a dead one.
    dto.rawFileUrl = await this.storage.createPresignedDownload(
      run.storageKey,
      { disposition: 'attachment', filename: run.uploadedFilename },
    );
    return dto;
  }

  /**
   * Commit a previewed run.
   *
   * Two gates, both server-side:
   *
   * 1. The run must be `previewed`. Committing something still parsing would
   *    write from a file nobody has seen the shape of; committing something
   *    already `completed` would be a silent double-import (harmless, because
   *    the writes are upserts, but it would report nonsense).
   * 2. If the preview flagged an agency mismatch, `confirmAgencyMismatch` must
   *    be explicitly true. The flag lives on the run, so a client cannot get
   *    past this by omitting the field.
   */
  async commitImport(
    runId: string,
    dto: CommitMailerImportDto,
  ): Promise<MailerImportRunDto> {
    const run = await this.findRun(runId);

    if (run.status !== 'previewed') {
      throw new ConflictException(
        `This import cannot be committed while it is "${run.status}".`,
      );
    }
    if (run.agencyMismatch && dto.confirmAgencyMismatch !== true) {
      throw new ConflictException(
        'The file reports a different agency than the one selected. ' +
          'Re-send with confirmAgencyMismatch: true to import it anyway.',
      );
    }

    run.status = 'importing';
    run.mismatchConfirmed = run.agencyMismatch;
    await run.save();

    await this.inngest.send(mailerImportCommitRequested, {
      importRunId: run._id.toString(),
      agencyId: run.agencyId,
      storageKey: run.storageKey,
      requestedBy: run.requestedBy,
    });

    return this.toDto(run);
  }

  /** Recent runs for one agency, newest first. Backs the panel's history list. */
  async listImports(
    agencyId: string,
    limit = 20,
  ): Promise<MailerImportRunDto[]> {
    const runs = await this.runModel
      .find({ agencyId })
      .sort({ createdAt: -1 })
      .limit(limit);
    return runs.map((run) => this.toDto(run));
  }

  private async findRun(runId: string): Promise<MailerImportRunDocument> {
    if (!Types.ObjectId.isValid(runId)) {
      throw new NotFoundException('Import not found.');
    }
    const run = await this.runModel.findById(runId);
    if (!run) {
      throw new NotFoundException('Import not found.');
    }
    return run;
  }

  private async assertAgencyExists(agencyId: string): Promise<void> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found.');
    }
    const exists = await this.agencyModel.exists({ _id: agencyId });
    if (!exists) {
      throw new NotFoundException('Agency not found.');
    }
  }

  /**
   * Document to wire shape.
   *
   * `storageKey` is deliberately **not** exposed: the key is the security
   * boundary for uploads (see `assertKeyOwnership`), and the panel reaches the
   * raw file through a presigned URL instead. Same rule the deal-audit
   * attachments follow, where rows carry an `index` and never a key.
   */
  private toDto(run: MailerImportRunDocument): MailerImportRunDto {
    return {
      id: run._id.toString(),
      agencyId: run.agencyId,
      status: run.status,
      uploadedFilename: run.uploadedFilename,
      sizeBytes: run.sizeBytes,
      detected: run.detected ?? null,
      agencyMismatch: run.agencyMismatch,
      counts: run.counts
        ? {
            read: run.counts.read,
            mapped: run.counts.mapped,
            created: run.counts.created,
            updated: run.counts.updated,
            skipped: run.counts.skipped,
          }
        : null,
      rejections: run.rejections ?? [],
      error: run.error ?? null,
      startedAt: (run.createdAt ?? new Date()).toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    };
  }
}
