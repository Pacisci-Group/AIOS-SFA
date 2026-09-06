import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  carrierSlug,
  mailerControlNumberKey,
  type MailerCampaign as MailerCampaignDto,
  type MailerCampaignDefaults,
  type MailerCampaignFileUrl,
  type MailerCampaignListItem,
  type MailerCampaignListResponse,
  type MailerCampaignRecord,
  type MailerCampaignRecordsResponse,
  type MailerCampaignSettings,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Carrier,
  type CarrierDocument,
} from '../carriers/schemas/carrier.schema';
import {
  resolveAssignment,
  unmatchedCodeMessage,
} from '../common/mailers/campaign-assignment';
import { DEFAULT_MAILER_CARRIER } from '../common/mailers/mailer-carrier';
import {
  MAILER_CAMPAIGN_PURPOSE,
  canonicalMailerContentType,
} from '../common/mailers/mailer-file-types';
import {
  DEFAULT_MAILER_DISCOUNTS,
  campaignNumberForDate,
  normalizeCampaignNumber,
} from '../common/mailers/mailer-processor';
import { parseWeekNumber } from '../common/mailers/mailer-parse';
import {
  mailerCampaignCommitRequested,
  mailerCampaignOutputEmailRequested,
  mailerCampaignPreviewRequested,
} from '../inngest/events';
import { InngestService } from '../inngest/inngest.service';
import { Lead, type LeadDocument } from '../leads/schemas/lead.schema';
import { Agency, type AgencyDocument } from '../platform/schemas/agency.schema';
import { StorageService } from '../storage/storage.service';
import { User, type UserDocument } from '../users/schemas/user.schema';
import type {
  CampaignRecordsDto,
  CommitCampaignDto,
  CreateCampaignDto,
  EmailOutputDto,
  ListCampaignsDto,
  PresignCampaignFileDto,
  UpdateCampaignDto,
} from './dto/mailer-campaign.dto';
import { MailerZipMarketsService } from './mailer-zip-markets.service';
import { Mailer, type MailerDocument } from './schemas/mailer.schema';
import {
  MailerCampaign,
  type MailerCampaignDocument,
} from './schemas/mailer-campaign.schema';

/**
 * ApexReports' own form defaults, for a platform that has never run a campaign.
 *
 * ⚠ Starting values only. The floor in particular is **per campaign** — the one
 * real run we can inspect used $1,886.15 while Apex's form said $1,916.44 — so
 * these prefill a form and are never consulted again once a campaign stores
 * what it actually ran with.
 */
const APEX_DEFAULT_SETTINGS: MailerCampaignSettings = {
  premiumFloor: 1916.44,
  fileName: 'SFA-QBP',
  defaultMarket: 'Oklahoma City',
  marketPhones: { Tulsa: '918-984-6163', 'Oklahoma City': '405-803-7590' },
  defaultPhone: '405-803-7590',
  runYear: new Date().getFullYear(),
  discounts: DEFAULT_MAILER_DISCOUNTS,
  zipResolutions: {},
  outputRecipients: [],
};

/** Statuses a `PATCH` or a re-preview is legal from. */
const EDITABLE_STATUSES = ['uploaded', 'previewed', 'failed'] as const;

/**
 * The request-bound half of mailer campaigns (PAC-71).
 *
 * Presign, record, gate, report. **Nothing here parses a file or writes a
 * mailer** — a 23 MB workbook is not something to hold an HTTP request open
 * for, so the transform and the import run in the worker
 * (`worker/functions/mailer-campaign-*.fn.ts`) and this service dispatches to
 * them and re-checks what they produced.
 *
 * ## The gate is the point
 *
 * A commit writes tens of thousands of documents and may delete some, so
 * `commit()` re-verifies every number the operator was shown: the assignment is
 * resolved *again* (appointments may have changed since the preview), the
 * replaced campaigns' live row count must still match, and the delete count
 * must be the one they confirmed. A number that moved is a `409` they have to
 * look at, never a silent proceed. The status transition itself is a
 * compare-and-set, so two operators pressing Commit cannot both start a run.
 */
@Injectable()
export class MailerCampaignsService {
  private readonly logger = new Logger(MailerCampaignsService.name);

  constructor(
    @InjectModel(MailerCampaign.name)
    private readonly campaignModel: Model<MailerCampaignDocument>,
    @InjectModel(Mailer.name)
    private readonly mailerModel: Model<MailerDocument>,
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    @InjectModel(Carrier.name)
    private readonly carrierModel: Model<CarrierDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly storage: StorageService,
    private readonly inngest: InngestService,
    private readonly zipMarkets: MailerZipMarketsService,
  ) {}

  // -------------------------------------------------------------------------
  // Defaults and upload
  // -------------------------------------------------------------------------

  /**
   * What the Run a campaign form prefills with.
   *
   * The **last imported campaign's** settings, because "last used" is what
   * Apex's presets amounted to, falling back to {@link APEX_DEFAULT_SETTINGS}.
   * `runYear` and `campaignNumber` are always *now* — re-running a past
   * campaign is a deliberate act, and inheriting last year from a stored
   * snapshot would age every home by a year without anyone choosing to.
   */
  async defaults(): Promise<MailerCampaignDefaults> {
    const carrier = await this.defaultCarrier();
    const last = await this.campaignModel
      .findOne({ status: 'imported', settings: { $ne: null } })
      .sort({ createdAt: -1 })
      .select({ settings: 1, assignment: 1 })
      .lean();

    const settings = last?.settings ?? APEX_DEFAULT_SETTINGS;

    return {
      carrierId: carrier ? carrier._id.toString() : null,
      carrierName: carrier?.name ?? null,
      campaignNumber: campaignNumberForDate(),
      settings: {
        ...settings,
        runYear: new Date().getFullYear(),
        // Never inherited: last run's unmapped ZIPs were resolved for *that*
        // file, and carrying them forward would hide new ones in this preview.
        zipResolutions: {},
      },
      assignment: last?.assignment
        ? { mode: last.assignment.mode, agencyIds: last.assignment.agencyIds }
        : { mode: 'carrier_agency_id', agencyIds: [] },
    };
  }

  /** A short-lived PUT URL so the file bytes never pass through the API. */
  presign(dto: PresignCampaignFileDto) {
    const key = this.storage.buildPlatformObjectKey({
      purpose: MAILER_CAMPAIGN_PURPOSE,
      filename: dto.filename,
      parts: ['vendor'],
    });
    // Signed with the type derived from the extension, not with whatever the
    // browser reported — see `canonicalMailerContentType`.
    return this.storage.createPresignedUpload(
      key,
      canonicalMailerContentType(dto.filename),
    );
  }

  // -------------------------------------------------------------------------
  // Create / update / dispatch
  // -------------------------------------------------------------------------

  /**
   * Record the upload and start the preview.
   *
   * Nothing is written to `mailers` here or by the job this starts — the
   * operator sees what the file contains before deciding.
   */
  async create(
    dto: CreateCampaignDto,
    requestedBy: string,
  ): Promise<MailerCampaignDto> {
    this.storage.assertPlatformKeyOwnership(dto.storageKey, {
      purpose: MAILER_CAMPAIGN_PURPOSE,
    });

    const carrier = dto.carrierId
      ? await this.carrierModel.findById(dto.carrierId).lean()
      : await this.defaultCarrier();
    if (!carrier) {
      throw new BadRequestException(
        `No ${DEFAULT_MAILER_CARRIER} carrier is configured. Run the core seed first.`,
      );
    }
    await this.assertAgenciesExist(dto.assignment.agencyIds);

    // `HeadObject` is the only server-side evidence of what was really stored:
    // a presigned PUT signs only `Content-Type`, so a declared size validates
    // the client's claim rather than the object.
    const stat = await this.storage.statObject(dto.storageKey);
    if (!stat) {
      throw new BadRequestException(
        'The uploaded file was not found in storage. Please upload it again.',
      );
    }
    if (stat.size === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    if (stat.size !== dto.size) {
      throw new BadRequestException(
        `The uploaded file is ${stat.size} bytes, not the ${dto.size} declared. Please upload it again.`,
      );
    }

    const campaignNumber = normalizeCampaignNumber(
      dto.campaignNumber ?? campaignNumberForDate(),
    );

    const campaign = await this.campaignModel.create({
      carrierId: carrier._id,
      name: dto.name?.trim() || this.defaultName(campaignNumber, dto),
      campaignNumber,
      weekNumber: parseWeekNumber(campaignNumber) ?? null,
      year: dto.settings.runYear,
      status: 'uploaded',
      source: dto.source,
      assignment: {
        mode: dto.assignment.mode,
        agencyIds: dto.assignment.agencyIds,
      },
      settings: dto.settings,
      vendorFile: {
        storageKey: dto.storageKey,
        name: dto.uploadedFilename,
        size: stat.size,
        contentType: stat.contentType ?? dto.contentType,
      },
      previewAttempt: 1,
      requestedBy: new Types.ObjectId(requestedBy),
    });

    await this.dispatchPreview(campaign, requestedBy);
    return this.toDto(campaign);
  }

  /**
   * Change the settings and re-preview.
   *
   * `zipResolutions` are also written into the platform table (`source:
   * 'preview'`), which is the whole of Apex's resolver flow: the answer the
   * operator gives once is reused by every campaign after this one.
   */
  async patch(
    id: string,
    dto: UpdateCampaignDto,
    requestedBy: string,
  ): Promise<MailerCampaignDto> {
    const campaign = await this.find(id);
    this.assertEditable(campaign);

    if (dto.assignment) {
      await this.assertAgenciesExist(dto.assignment.agencyIds);
      campaign.assignment = {
        mode: dto.assignment.mode,
        agencyIds: dto.assignment.agencyIds,
      };
    }
    if (dto.carrierId) {
      const carrier = await this.carrierModel.findById(dto.carrierId).lean();
      if (!carrier) throw new BadRequestException('Unknown carrier.');
      campaign.carrierId = carrier._id;
    }
    if (dto.name) campaign.name = dto.name.trim();
    if (dto.campaignNumber !== undefined) {
      campaign.campaignNumber = normalizeCampaignNumber(dto.campaignNumber);
      campaign.weekNumber = parseWeekNumber(campaign.campaignNumber) ?? null;
    }
    if (dto.settings) {
      campaign.settings = dto.settings;
      campaign.year = dto.settings.runYear;

      const entries = Object.entries(dto.settings.zipResolutions);
      if (entries.length > 0) {
        await this.zipMarkets.upsertMany(
          {
            entries: entries.map(([zip5, market]) => ({ zip5, market })),
          },
          requestedBy,
          'preview',
        );
      }
    }

    // Back to `uploaded`: the stored preview described the *old* settings, and
    // leaving it in place would let a commit gate itself against numbers that
    // no longer describe what would run.
    campaign.status = 'uploaded';
    campaign.error = null;
    campaign.preview = null;
    campaign.previewAttempt += 1;
    await campaign.save();

    await this.dispatchPreview(campaign, requestedBy);
    return this.toDto(campaign);
  }

  /** Re-run the preview without changing anything — the recovery path. */
  async preview(id: string, requestedBy: string): Promise<MailerCampaignDto> {
    const campaign = await this.find(id);
    this.assertEditable(campaign);

    campaign.status = 'uploaded';
    campaign.error = null;
    campaign.previewAttempt += 1;
    await campaign.save();

    await this.dispatchPreview(campaign, requestedBy);
    return this.toDto(campaign);
  }

  /**
   * Send the preview event, and mark the campaign `failed` if it cannot be sent.
   *
   * The campaign is written **before** the event so its id can go in the
   * payload. That ordering means a failed dispatch would otherwise leave a
   * record sitting in `uploaded` for ever, with a spinner the operator cannot
   * clear and no way to tell a queue outage from a slow file. The error is
   * still rethrown: the caller asked for work to be queued and it was not.
   */
  private async dispatchPreview(
    campaign: MailerCampaignDocument,
    requestedBy: string,
  ): Promise<void> {
    await this.dispatch(campaign, () =>
      this.inngest.send(mailerCampaignPreviewRequested, {
        campaignId: campaign._id.toString(),
        attempt: campaign.previewAttempt,
        requestedBy,
      }),
    );
  }

  private async dispatch(
    campaign: MailerCampaignDocument,
    send: () => Promise<void>,
  ): Promise<void> {
    try {
      await send();
    } catch (error) {
      const message = (error as Error).message;
      await this.campaignModel.updateOne(
        { _id: campaign._id },
        {
          $set: {
            status: 'failed',
            error: `Could not queue the job: ${message}`,
            finishedAt: new Date(),
          },
        },
      );
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------

  /**
   * Start the real run.
   *
   * Five gates, in the order that fails cheapest first, then a compare-and-set.
   * Each one exists because the alternative is a wrong write nobody asked for —
   * see the class note.
   */
  async commit(
    id: string,
    dto: CommitCampaignDto,
    requestedBy: string,
  ): Promise<MailerCampaignDto> {
    const campaign = await this.find(id);

    // 1. Only a previewed campaign may commit. Committing something still
    //    parsing would write from a file nobody has seen the shape of.
    if (campaign.status !== 'previewed') {
      throw new ConflictException(
        `This campaign cannot be committed while it is "${campaign.status}".`,
      );
    }
    const preview = campaign.preview;
    if (!preview) {
      throw new ConflictException('Run a preview before committing.');
    }

    // 2. The preview's own verdict on the assignment.
    const carrier = await this.carrierModel.findById(campaign.carrierId).lean();
    const carrierName = carrier?.name ?? DEFAULT_MAILER_CARRIER;
    if (preview.assignment.unmatched.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Some carrier agency codes match no agency.',
        errors: preview.assignment.unmatched.map((code) =>
          unmatchedCodeMessage(
            code,
            this.rowsForCode(campaign, code),
            carrierName,
          ),
        ),
      });
    }

    // 3. Resolve again *now*: an appointment may have been added or revoked
    //    since the preview, and the commit is what actually routes the rows.
    const codeCounts = Object.fromEntries(
      preview.assignment.resolved.map((row) => [row.codeKey, row.rows]),
    );
    const resolution = await resolveAssignment(
      this.agencyModel,
      { carrierId: campaign.carrierId, assignment: campaign.assignment },
      codeCounts,
    );
    if (resolution.unmatched.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'Carrier appointments changed since the preview — some codes now match no agency.',
        errors: resolution.unmatched.map((code) =>
          unmatchedCodeMessage(code, codeCounts[code] ?? 0, carrierName),
        ),
      });
    }

    // 4–6. Overwrite is the only mode that deletes, so it is the only one that
    //      has to agree with the operator about a number.
    if (dto.mode === 'overwrite') {
      const offered = new Set(
        preview.existingCampaigns.map((row) => row.campaignId),
      );
      const unknown = dto.replaceCampaignIds.filter((cid) => !offered.has(cid));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `These campaigns were not offered as replaceable: ${unknown.join(', ')}.`,
        );
      }

      const liveCount = await this.mailerModel.countDocuments({
        campaignId: { $in: dto.replaceCampaignIds },
      });
      if (liveCount !== preview.overlap.replacedRecordCount) {
        throw new ConflictException(
          `The campaigns being replaced now hold ${liveCount} mailers, not the ` +
            `${preview.overlap.replacedRecordCount} this preview counted. Re-run the preview.`,
        );
      }
      if (dto.expectedDeleteCount !== preview.overlap.deleteCountIfOverwrite) {
        throw new ConflictException(
          `This overwrite would delete ${preview.overlap.deleteCountIfOverwrite} mailers, ` +
            `not the ${dto.expectedDeleteCount} confirmed. Re-run the preview.`,
        );
      }
    }

    // 7. Compare-and-set. Two operators pressing Commit cannot both win, and
    //    the loser gets a 409 rather than a second import of the same file.
    const started = await this.campaignModel.findOneAndUpdate(
      { _id: campaign._id, status: 'previewed' },
      {
        $set: {
          status: 'processing',
          commitMode: dto.mode,
          replaceCampaignIds:
            dto.mode === 'overwrite' ? dto.replaceCampaignIds : [],
          expectedDeleteCount:
            dto.mode === 'overwrite' ? dto.expectedDeleteCount : null,
          requestedBy: new Types.ObjectId(requestedBy),
          error: null,
        },
        $inc: { commitAttempt: 1 },
      },
      { new: true },
    );
    if (!started) {
      throw new ConflictException(
        'This campaign was started by someone else. Reload to see its state.',
      );
    }

    await this.dispatch(started, () =>
      this.inngest.send(mailerCampaignCommitRequested, {
        campaignId: started._id.toString(),
        attempt: started.commitAttempt,
        requestedBy,
      }),
    );
    return this.toDto(started);
  }

  /** Rows the file carries under one carrier agency code, from the preview. */
  private rowsForCode(campaign: MailerCampaignDocument, code: string): number {
    return (
      campaign.preview?.assignment.resolved.find((row) => row.codeKey === code)
        ?.rows ?? 0
    );
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(query: ListCampaignsDto): Promise<MailerCampaignListResponse> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.carrierId) filter.carrierId = new Types.ObjectId(query.carrierId);
    if (query.agencyId) {
      // An `all` campaign is visible to every agency, so filtering by one must
      // include them — otherwise the list contradicts the drawer.
      filter.$or = [
        { 'assignment.agencyIds': query.agencyId },
        { 'assignment.mode': 'all' },
      ];
    }
    if (query.q) {
      const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$and = [
        {
          $or: [
            { name: { $regex: escaped, $options: 'i' } },
            { campaignNumber: { $regex: escaped, $options: 'i' } },
          ],
        },
      ];
    }

    const [total, rows] = await Promise.all([
      this.campaignModel.countDocuments(filter),
      this.campaignModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
    ]);

    const ids = rows.map((row) => row._id.toString());
    const [recordCounts, leadCounts, names, agencyNames] = await Promise.all([
      this.countBy(this.mailerModel, 'campaignId', ids),
      this.countBy(this.leadModel, 'mailer.campaignId', ids),
      this.userNames(rows.map((row) => row.requestedBy)),
      this.agencyNames(rows.flatMap((row) => row.assignment.agencyIds)),
    ]);

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      items: rows.map((row): MailerCampaignListItem => {
        const id = row._id.toString();
        return {
          id,
          name: row.name,
          campaignNumber: row.campaignNumber ?? null,
          weekNumber: row.weekNumber,
          year: row.year,
          status: row.status,
          source: row.source,
          assignment: {
            mode: row.assignment.mode,
            agencyIds: row.assignment.agencyIds,
          },
          visibleAgencyNames: this.visibleAgencyNames(row, agencyNames),
          premiumFloor: row.settings?.premiumFloor ?? null,
          quoteDate: row.quoteDate ? row.quoteDate.toISOString() : null,
          requestedByName: row.requestedBy
            ? (names.get(row.requestedBy.toString()) ?? null)
            : null,
          createdAt: (row.createdAt ?? new Date()).toISOString(),
          recordCount: recordCounts.get(id) ?? 0,
          leadsAttributed: leadCounts.get(id) ?? 0,
        };
      }),
    };
  }

  async get(id: string): Promise<MailerCampaignDto> {
    return this.toDto(await this.find(id));
  }

  /**
   * The campaign detail's records table.
   *
   * `q` is normalized to a control-number key when it can be — that is one
   * indexed equality against `controlNumberKeys`, and it answers **either**
   * printed form. Only when the query is not control-number shaped does it fall
   * back to an anchored name match, which the `{campaignId, lastName, firstName}`
   * index serves.
   */
  async records(
    id: string,
    query: CampaignRecordsDto,
  ): Promise<MailerCampaignRecordsResponse> {
    const campaign = await this.find(id);
    const filter: Record<string, unknown> = {
      campaignId: campaign._id.toString(),
    };

    if (query.q) {
      const key = mailerControlNumberKey(query.q);
      const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        ...(key ? [{ controlNumberKeys: key }] : []),
        { lastName: { $regex: `^${escaped}`, $options: 'i' } },
        { firstName: { $regex: `^${escaped}`, $options: 'i' } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.mailerModel.countDocuments(filter),
      this.mailerModel
        .find(filter)
        .sort({ lastName: 1, firstName: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
    ]);

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      items: rows.map((row): MailerCampaignRecord => ({
        id: row._id.toString(),
        controlNumber: row.controlNumber ?? null,
        newControlNumber: row.newControlNumber ?? null,
        name:
          row.fullName ??
          [row.firstName, row.lastName].filter(Boolean).join(' ') ??
          null,
        city: row.address?.city ?? null,
        state: row.address?.state ?? null,
        zip: row.address?.zip ?? null,
        market: row.market ?? null,
        premiumYearly: row.premium?.yearly ?? null,
        carrierAgencyId: row.carrierAgencyId ?? null,
        visibleAgencyIds: row.visibleAgencyIds ?? null,
      })),
    };
  }

  /**
   * Mint a download link on click.
   *
   * Presigned URLs expire, so the link is never stored on the campaign — a
   * detail page left open for ten minutes would otherwise hand out a dead one.
   * The storage key stays server-side: it is a capability, not an identifier.
   */
  async fileUrl(
    id: string,
    kind: 'vendor' | 'output',
  ): Promise<MailerCampaignFileUrl> {
    const campaign = await this.find(id);
    const file = kind === 'vendor' ? campaign.vendorFile : campaign.outputFile;
    if (!file) {
      throw new NotFoundException(`This campaign has no ${kind} file.`);
    }
    const url = await this.storage.createPresignedDownload(file.storageKey, {
      disposition: 'attachment',
      filename: file.name,
    });
    return {
      url,
      filename: file.name,
      expiresIn: this.storage.downloadUrlTtlSeconds,
    };
  }

  /** Re-send the completion notice, to the stored recipients or to a new list. */
  async emailOutput(
    id: string,
    dto: EmailOutputDto,
    requestedBy: string,
  ): Promise<{ queued: number }> {
    const campaign = await this.find(id);
    if (campaign.status !== 'imported' || !campaign.outputFile) {
      throw new ConflictException(
        'The output can only be emailed once the campaign has imported.',
      );
    }
    const recipients =
      dto.recipients ?? campaign.settings?.outputRecipients ?? [];
    if (recipients.length === 0) {
      throw new BadRequestException(
        'No recipients: add them to the campaign settings or pass them here.',
      );
    }

    await this.inngest.send(mailerCampaignOutputEmailRequested, {
      campaignId: campaign._id.toString(),
      attempt: campaign.commitAttempt,
      requestedBy,
      recipients,
    });
    return { queued: recipients.length };
  }

  /**
   * Discard a campaign that never imported.
   *
   * Only from a pre-commit state, and the vendor object goes with it. An
   * `imported` campaign is never deletable: `Lead.mailer.campaignId` points at
   * it, and attribution outliving the run is the whole reason the record exists
   * — an overwrite marks the old one `superseded` rather than removing it.
   */
  async remove(id: string): Promise<{ deleted: true }> {
    const campaign = await this.find(id);
    if (!EDITABLE_STATUSES.includes(campaign.status as 'uploaded')) {
      throw new ConflictException(
        `A campaign cannot be deleted while it is "${campaign.status}".`,
      );
    }
    await this.campaignModel.deleteOne({ _id: campaign._id });
    if (campaign.vendorFile) {
      // Best effort: the record is already gone, and a stranded object is a
      // storage-lifecycle problem rather than a reason to fail the request.
      await this.storage
        .deleteObject(campaign.vendorFile.storageKey)
        .catch((error: Error) =>
          this.logger.warn(
            `Could not delete ${campaign.vendorFile?.storageKey}: ${error.message}`,
          ),
        );
    }
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async find(id: string): Promise<MailerCampaignDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Campaign not found.');
    }
    const campaign = await this.campaignModel.findById(id);
    if (!campaign) throw new NotFoundException('Campaign not found.');
    return campaign;
  }

  private assertEditable(campaign: MailerCampaignDocument): void {
    if (!EDITABLE_STATUSES.includes(campaign.status as 'uploaded')) {
      throw new ConflictException(
        `This campaign cannot be changed while it is "${campaign.status}".`,
      );
    }
  }

  private defaultCarrier() {
    return this.carrierModel
      .findOne({ agencyId: null, slug: carrierSlug(DEFAULT_MAILER_CARRIER) })
      .lean();
  }

  private async assertAgenciesExist(agencyIds: string[]): Promise<void> {
    if (agencyIds.length === 0) return;
    const found = await this.agencyModel.countDocuments({
      _id: { $in: agencyIds },
    });
    if (found !== new Set(agencyIds).size) {
      throw new BadRequestException('One or more agencies do not exist.');
    }
  }

  private defaultName(campaignNumber: string, dto: CreateCampaignDto): string {
    const week = campaignNumber || 'unnumbered';
    const label = dto.source === 'processed' ? 'processed file' : 'campaign';
    return `${dto.settings.fileName} ${week} ${label}`.trim();
  }

  /** One `$group` per collection, rather than a count query per row. */
  private async countBy(
    model: Model<MailerDocument> | Model<LeadDocument>,
    field: string,
    ids: string[],
  ): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await model.aggregate<{ _id: string; n: number }>([
      { $match: { [field]: { $in: ids } } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [row._id, row.n]));
  }

  private async userNames(
    ids: (Types.ObjectId | null)[],
  ): Promise<Map<string, string>> {
    const present = ids.filter((id): id is Types.ObjectId => Boolean(id));
    if (present.length === 0) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: present } })
      .select({ firstName: 1, lastName: 1, email: 1 })
      .lean();
    return new Map(
      users.map((user) => [
        user._id.toString(),
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
      ]),
    );
  }

  private async agencyNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const agencies = await this.agencyModel
      .find({ _id: { $in: unique } })
      .select({ name: 1 })
      .lean();
    return new Map(
      agencies.map((agency) => [agency._id.toString(), agency.name]),
    );
  }

  /**
   * The list's "visible agencies" column.
   *
   * ⚠ `null` means **all agencies**, never "none" — the same distinction
   * `Mailer.visibleAgencyIds` carries. In `carrier_agency_id` mode the audience
   * is whatever the file resolved to, which only the preview knows.
   */
  private visibleAgencyNames(
    row: {
      assignment: { mode: string; agencyIds: string[] };
      preview: unknown;
    },
    names: Map<string, string>,
  ): string[] | null {
    if (row.assignment.mode === 'all') return null;
    if (row.assignment.mode === 'agencies') {
      return row.assignment.agencyIds.map((id) => names.get(id) ?? id);
    }
    const preview = row.preview as {
      assignment?: { resolved?: { agencyName: string | null }[] };
    } | null;
    const resolved = preview?.assignment?.resolved ?? [];
    return [
      ...new Set(
        resolved
          .map((entry) => entry.agencyName)
          .filter((name): name is string => Boolean(name)),
      ),
    ];
  }

  /**
   * Document to wire shape.
   *
   * ⚠ `storageKey` never crosses this line. The key is the security boundary
   * for uploads (`assertPlatformKeyOwnership`), and the client reaches a file
   * through the presigned-URL endpoint instead. Same rule the deal-audit
   * attachments follow.
   */
  private async toDto(
    campaign: MailerCampaignDocument,
  ): Promise<MailerCampaignDto> {
    const [carrier, names] = await Promise.all([
      this.carrierModel.findById(campaign.carrierId).select({ name: 1 }).lean(),
      this.userNames([campaign.requestedBy]),
    ]);

    return {
      id: campaign._id.toString(),
      name: campaign.name,
      carrierId: campaign.carrierId.toString(),
      carrierName: carrier?.name ?? null,
      campaignNumber: campaign.campaignNumber ?? null,
      weekNumber: campaign.weekNumber,
      year: campaign.year,
      status: campaign.status,
      source: campaign.source,
      assignment: {
        mode: campaign.assignment.mode,
        agencyIds: campaign.assignment.agencyIds,
      },
      carrierAgencyIds: campaign.carrierAgencyIds,
      carrierAgencyNames: campaign.carrierAgencyNames,
      settings: campaign.settings ? campaign.settings : null,
      vendorFile: campaign.vendorFile
        ? {
            name: campaign.vendorFile.name,
            size: campaign.vendorFile.size,
            sha256: campaign.vendorFile.sha256,
          }
        : null,
      outputFile: campaign.outputFile
        ? {
            name: campaign.outputFile.name,
            size: campaign.outputFile.size,
            sha256: campaign.outputFile.sha256,
          }
        : null,
      stats: campaign.stats,
      preview: campaign.preview,
      importCounts: campaign.importCounts,
      rejections: campaign.rejections,
      commitMode: campaign.commitMode,
      replaceCampaignIds: campaign.replaceCampaignIds,
      expectedDeleteCount: campaign.expectedDeleteCount,
      error: campaign.error,
      requestedBy: campaign.requestedBy?.toString() ?? null,
      requestedByName: campaign.requestedBy
        ? (names.get(campaign.requestedBy.toString()) ?? null)
        : null,
      quoteDate: campaign.quoteDate ? campaign.quoteDate.toISOString() : null,
      createdAt: (campaign.createdAt ?? new Date()).toISOString(),
      updatedAt: (campaign.updatedAt ?? new Date()).toISOString(),
      finishedAt: campaign.finishedAt
        ? campaign.finishedAt.toISOString()
        : null,
      supersededByCampaignId: campaign.supersededByCampaignId,
    };
  }
}
