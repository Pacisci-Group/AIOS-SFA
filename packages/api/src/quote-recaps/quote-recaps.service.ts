import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  QUOTE_ADVANCE_TARGET,
  normalizeLeadStatus,
  quoteAdvanceableStatusValues,
} from '@sfa/shared';
import type {
  AccessContext,
  CreateQuoteRecapResponse,
  DocumentDownloadResponse,
  QuoteDocumentPresignResponse,
  QuoteRecapLeadContext,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { resolveHouseholdAddress } from '../common/address/household-address';
import type { StructuredAddress } from '../common/address/household-address';
import { roundCents } from '../common/domain/money';
import {
  ResolvedTenantContext,
  TenantContextResolver,
} from '../common/tenancy/tenant-context.resolver';
import { quoteDateYmd } from './quote.normalize';
import { HouseholdDocument } from '../households/schemas/household.schema';
import { LeadAccessService } from '../leads/lead-access.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { StorageService } from '../storage/storage.service';
import { CreateQuoteRecapDto } from './dto/create-quote-recap.dto';
import {
  ALLOWED_QUOTE_DOCUMENT_CONTENT_TYPES,
  MAX_QUOTE_DOCUMENT_BYTES,
  PresignQuoteDocumentDto,
} from './dto/presign-quote-document.dto';
import { QuoteRecap, QuoteRecapDocument } from './schemas/quote-recap.schema';

/** Mongo duplicate-key error. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

const ALLOWED_CONTENT_TYPES = new Set<string>(
  ALLOWED_QUOTE_DOCUMENT_CONTENT_TYPES,
);

/**
 * Quote Recap write path (PAC-39) — the native replacement for the legacy
 * Fillout `quote-recap` webhook.
 *
 * Lead-scoped by design: legacy rejects a recap with no `lead_id` ("Cannot link
 * quote recap to lead"), and a recap that isn't attached to a lead can't be
 * found from the page a producer actually works in. The household is resolved
 * from the lead server-side and never accepted from the client.
 */
@Injectable()
export class QuoteRecapsService {
  private readonly logger = new Logger(QuoteRecapsService.name);

  constructor(
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecapDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly storage: StorageService,
    private readonly leadAccess: LeadAccessService,
  ) {}

  /**
   * The read-only context the form shows on mount, so a producer can confirm
   * they're recapping the right household before entering anything.
   */
  async getLeadContext(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
  ): Promise<QuoteRecapLeadContext> {
    const lead = await this.leadAccess.loadOwnedLead(access, branchId, leadId);
    const household = await this.leadAccess.findHousehold(lead, access);

    return {
      leadId: lead._id.toString(),
      primaryContactName:
        [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() ||
        'Unnamed lead',
      // `null` rather than a 409 here: the form can block up front instead of
      // letting the producer fill everything in and fail at submit.
      householdId: household?._id.toString() ?? null,
      householdName: household?.name ?? null,
      householdAddress: this.householdAddress(lead, household),
      leadStatus: normalizeLeadStatus(lead.status),
    };
  }

  /**
   * Issue a presigned PUT for the quote document.
   *
   * Scoped to the **lead**, not the recap: the document is uploaded while the
   * recap is being composed, so no recap id exists yet. The key that comes back
   * embeds the agency and lead, which is what `create` later verifies.
   */
  async presignQuoteDocument(
    access: AccessContext,
    branchId: string | null,
    dto: PresignQuoteDocumentDto,
  ): Promise<QuoteDocumentPresignResponse> {
    // Ownership first — a presign is a write, and must not leak the existence
    // of another producer's lead.
    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      dto.leadId,
    );

    const key = this.storage.buildObjectKey({
      // From the document, never the request.
      agencyId: lead.agencyId,
      purpose: `quote-recaps/${lead._id.toString()}`,
      filename: dto.filename,
    });

    const presigned = await this.storage.createPresignedUpload(
      key,
      dto.contentType,
    );
    return {
      key: presigned.key,
      uploadUrl: presigned.uploadUrl,
      requiredHeaders: presigned.requiredHeaders,
      expiresIn: presigned.expiresIn,
    };
  }

  /**
   * A short-lived URL that opens the uploaded quote document (PAC-56 #10, #30).
   *
   * Signed **inline**, so following it renders the PDF in the browser's own
   * viewer in a new tab rather than downloading it — the user downloads from
   * there. That is the whole feature: no bespoke viewer, no download button.
   *
   * Gated on `quote_recaps:read` and clamped to the caller's data scope by
   * `assertOwned`, so a producer cannot open a colleague's document by guessing
   * a recap id. The storage key never crosses the wire in either direction.
   */
  async getDocumentDownload(
    access: AccessContext,
    branchId: string | null,
    recapId: string,
  ): Promise<DocumentDownloadResponse> {
    if (!Types.ObjectId.isValid(recapId)) {
      throw new NotFoundException('Quote recap not found.');
    }

    const recap = await this.quoteRecapModel.findOne({
      _id: new Types.ObjectId(recapId),
      agencyId: access.agencyId,
    });
    if (!recap) throw new NotFoundException('Quote recap not found.');

    // Same clamp the replay path uses — 404, never 403.
    this.leadAccess.assertOwned(recap, access, branchId);

    const document = recap.quoteDocument;
    if (!document) {
      throw new NotFoundException('This quote recap has no document.');
    }

    const downloadUrl = await this.storage.createPresignedDownload(
      document.key,
      {
        disposition: 'inline',
        filename: document.filename,
        // Overridden explicitly: the object was stored with whatever the
        // browser claimed on upload, and a PDF served as octet-stream
        // downloads instead of rendering however the disposition is set.
        contentType: document.contentType,
      },
    );

    return {
      downloadUrl,
      filename: document.filename,
      contentType: document.contentType,
      expiresIn: this.storage.downloadUrlTtlSeconds,
    };
  }

  async create(
    access: AccessContext,
    branchId: string | null,
    dto: CreateQuoteRecapDto,
  ): Promise<CreateQuoteRecapResponse> {
    const tenant = await this.tenancy.resolve(access, branchId);
    const token = this.buildSubmissionToken(dto.submissionToken);

    // Probe before doing any work, the same reasoning as lead intake: a replay
    // should not re-run household resolution or re-verify storage.
    if (token) {
      const replay = await this.quoteRecapModel.findOne({
        agencyId: tenant.agencyId,
        submissionToken: token,
      });
      if (replay) {
        // Clamp the *found* recap, so a token replayed by another producer 404s
        // rather than handing back someone else's id.
        this.leadAccess.assertOwned(replay, access, branchId);
        const leadStatus = await this.advanceLeadStatus(replay.leadId, tenant);
        return this.toResponse(replay, leadStatus);
      }
    }

    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      dto.leadId,
    );
    const household = await this.leadAccess.resolveHousehold(lead, access);

    this.storage.assertKeyOwnership(dto.quoteDocument.key, {
      agencyId: tenant.agencyId,
      purpose: `quote-recaps/${lead._id.toString()}`,
    });
    const stored = await this.verifyQuoteDocument(dto.quoteDocument.key);

    const policies = dto.policies.map((p) => ({
      policyType: p.policyType,
      premium: roundCents(p.premium),
      itemCount: p.itemCount,
    }));
    const quoteDate = new Date();

    try {
      const recap = await this.quoteRecapModel.create({
        agencyId: tenant.agencyId,
        branchId: tenant.branchId,
        title: household.name ? `${household.name} — Quote` : 'Quote',
        quoteDate,
        // The indexed calendar-day label the Quoted scorecard buckets by
        // (PAC-10). Derived here rather than at read time so the scorecard is a
        // plain integer range — the same reason `Deal.soldDateYmd` is persisted.
        quoteDateYmd: quoteDateYmd(quoteDate),
        // Derived server-side and never taken from the client: these three back
        // the Quoted scorecard, so a client-supplied total would corrupt it.
        premium: roundCents(policies.reduce((sum, p) => sum + p.premium, 0)),
        itemCount: policies.reduce((sum, p) => sum + p.itemCount, 0),
        productsQuoted: [...new Set(policies.map((p) => p.policyType))],
        recapStatus: 'Submitted',
        producerId: new Types.ObjectId(access.userId),
        leadId: lead._id,
        householdId: household._id,
        policies,
        propertyAddress: this.resolvePropertyAddress(dto, lead, household),
        sameAsHousehold: dto.sameAsHousehold,
        notes: dto.notes,
        quoteDocument: {
          key: dto.quoteDocument.key,
          filename: dto.quoteDocument.filename,
          // From storage, not from the client's claim.
          contentType: stored.contentType,
          size: stored.size,
          uploadedAt: quoteDate,
        },
        submissionToken: token ?? undefined,
        isTestRecord: false,
      });

      // Both follow-ups are best-effort and post-commit. The recap is the only
      // irreplaceable thing in this request; rolling it back because a timeline
      // row failed would fail in the wrong direction.
      const leadStatus = await this.advanceLeadStatus(lead._id, tenant);
      await this.recordQuotedActivity(recap, tenant);

      return this.toResponse(recap, leadStatus);
    } catch (error) {
      // Two in-flight requests with the same token: the loser sees E11000 on
      // the unique `{agencyId, submissionToken}` index. Re-reading here is what
      // makes "a double-submit creates one recap" true under real concurrency
      // rather than only for a sequential retry.
      if (isDuplicateKeyError(error) && token) {
        const winner = await this.quoteRecapModel.findOne({
          agencyId: tenant.agencyId,
          submissionToken: token,
        });
        if (winner) {
          // Re-derive rather than reusing the now-stale in-memory lead: the
          // winning request advanced it. `advanceLeadStatus` is idempotent.
          const leadStatus = await this.advanceLeadStatus(lead._id, tenant);
          return this.toResponse(winner, leadStatus);
        }
      }
      throw error;
    }
  }

  private householdAddress(
    lead: LeadDocument,
    household: HouseholdDocument | null,
  ): StructuredAddress | null {
    return resolveHouseholdAddress(
      lead.address,
      household?.propertyAddress,
      household?.mailingAddress,
    );
  }

  private resolvePropertyAddress(
    dto: CreateQuoteRecapDto,
    lead: LeadDocument,
    household: HouseholdDocument,
  ): StructuredAddress | undefined {
    if (!dto.sameAsHousehold) return dto.propertyAddress;
    // The client's address is discarded when it claims "same as household", so
    // it cannot assert one thing and submit another.
    return this.householdAddress(lead, household) ?? undefined;
  }

  /**
   * Verify the upload actually landed, and take its real type and size.
   *
   * The presigned PUT signs only the content type, so nothing stops a caller
   * uploading a 5 GB file against a valid URL — the declared `size` in the body
   * is a claim, not evidence. This is what makes the type/size limits
   * server-side rather than advisory.
   */
  private async verifyQuoteDocument(
    key: string,
  ): Promise<{ contentType: string; size: number }> {
    const stored = await this.storage.statObject(key);
    if (!stored) {
      throw new NotFoundException(
        'Uploaded document was not found in storage.',
      );
    }
    if (stored.size > MAX_QUOTE_DOCUMENT_BYTES) {
      throw new BadRequestException('Quote document is larger than 10MB.');
    }
    if (!stored.contentType || !ALLOWED_CONTENT_TYPES.has(stored.contentType)) {
      throw new BadRequestException(
        'Quote document must be a PDF, JPEG or PNG.',
      );
    }
    return { contentType: stored.contentType, size: stored.size };
  }

  /**
   * Move the lead to "Quoted", forward only.
   *
   * One atomic conditional update: the forward-only rule is a database-level
   * invariant rather than a read-then-write race. `lastActivityAt` moves too,
   * because the Leads list sorts on it and a lead you just quoted should not
   * sink below untouched ones.
   *
   * Best-effort — the recap is already committed by the time this runs, and it
   * is idempotent, so the replay path re-runs it to self-heal a create whose
   * follow-up died.
   */
  private async advanceLeadStatus(
    leadId: Types.ObjectId | undefined,
    tenant: ResolvedTenantContext,
  ): Promise<string> {
    if (!leadId) return QUOTE_ADVANCE_TARGET;
    try {
      const advanced = await this.leadModel.findOneAndUpdate(
        {
          _id: leadId,
          agencyId: tenant.agencyId,
          status: { $in: quoteAdvanceableStatusValues() },
        },
        {
          $set: {
            status: QUOTE_ADVANCE_TARGET,
            lastActivityAt: new Date(),
          },
        },
        { new: true, projection: { status: 1 } },
      );
      if (advanced) return normalizeLeadStatus(advanced.status);

      // No match means the lead is already Quoted or terminal — one extra read
      // to report what it actually is, only on that branch.
      const current = await this.leadModel.findById(leadId).select('status');
      return normalizeLeadStatus(current?.status);
    } catch (error) {
      this.logger.error(
        `Failed to advance status for lead ${leadId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
      return QUOTE_ADVANCE_TARGET;
    }
  }

  /** Timeline entry, matching what the migration writes for a migrated recap. */
  private async recordQuotedActivity(
    recap: QuoteRecapDocument,
    tenant: ResolvedTenantContext,
  ): Promise<void> {
    try {
      await this.activityModel.create({
        agencyId: tenant.agencyId,
        branchId: tenant.branchId,
        type: 'quoted',
        subjectType: 'quoteRecap',
        leadId: recap.leadId,
        quoteRecapId: recap._id,
        producerId: recap.producerId,
        occurredAt: recap.quoteDate,
        summary: 'Quote recap created',
        // Explicit: `source` defaults to 'migration', so omitting it would label
        // an app-created activity as migrated.
        source: 'internal',
        isTestRecord: false,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record quoted activity for recap ${recap._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** `WEB|<UPPERCASED>`, matching the lead-intake namespacing convention. */
  private buildSubmissionToken(raw?: string | null): string | null {
    const token = raw?.trim();
    return token ? `WEB|${token.toUpperCase()}` : null;
  }

  private toResponse(
    recap: QuoteRecapDocument,
    leadStatus: string,
  ): CreateQuoteRecapResponse {
    return {
      id: recap._id.toString(),
      leadId: recap.leadId?.toString() ?? '',
      premium: recap.premium,
      itemCount: recap.itemCount,
      productsQuoted: recap.productsQuoted,
      quoteDate: (recap.quoteDate ?? new Date()).toISOString(),
      leadStatus,
    };
  }
}
