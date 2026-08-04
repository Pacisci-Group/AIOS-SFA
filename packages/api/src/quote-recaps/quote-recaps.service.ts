import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DataScope,
  QUOTE_ADVANCE_TARGET,
  normalizeLeadStatus,
  quoteAdvanceableStatusValues,
} from '@sfa/shared';
import type {
  AccessContext,
  CreateQuoteRecapResponse,
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
import {
  ResolvedTenantContext,
  TenantContextResolver,
} from '../common/tenancy/tenant-context.resolver';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
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

/** Money is summed in cents, so `1200.10 + 899.95` cannot drift to `…0499999`. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
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
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly storage: StorageService,
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
    const lead = await this.loadOwnedLead(access, branchId, leadId);
    const household = await this.findHousehold(lead, access);

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
    const lead = await this.loadOwnedLead(access, branchId, dto.leadId);

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
        this.assertRecapInScope(replay, access, branchId);
        const leadStatus = await this.advanceLeadStatus(replay.leadId, tenant);
        return this.toResponse(replay, leadStatus);
      }
    }

    const lead = await this.loadOwnedLead(access, branchId, dto.leadId);
    const household = await this.resolveHousehold(lead, access);

    this.assertKeyOwnership(
      dto.quoteDocument.key,
      tenant.agencyId,
      lead._id.toString(),
    );
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

  /**
   * Load a lead inside the caller's agency and enforce data scope.
   *
   * 404 throughout — the same shape as `ShareLinksService.loadOwnedLink`, and
   * for the same reason: whether another producer's lead exists is not the
   * caller's business. Note `Lead.producerId` is optional, so an **unassigned**
   * lead is also a 404 under `own` scope, which is correct.
   */
  private async loadOwnedLead(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
  ): Promise<LeadDocument> {
    // A malformed id is a miss, not a 500.
    if (!Types.ObjectId.isValid(leadId)) {
      throw new NotFoundException('Lead not found.');
    }

    const lead = await this.leadModel.findOne({
      _id: new Types.ObjectId(leadId),
      agencyId: access.agencyId,
    });
    if (!lead) throw new NotFoundException('Lead not found.');

    if (
      access.dataScope === DataScope.Own &&
      lead.producerId?.toString() !== access.userId
    ) {
      throw new NotFoundException('Lead not found.');
    }
    if (
      access.dataScope === DataScope.Branch &&
      branchId &&
      lead.branchId !== branchId
    ) {
      throw new NotFoundException('Lead not found.');
    }

    return lead;
  }

  /** The same clamp, applied to an already-loaded recap on the replay path. */
  private assertRecapInScope(
    recap: QuoteRecapDocument,
    access: AccessContext,
    branchId: string | null,
  ): void {
    if (
      access.dataScope === DataScope.Own &&
      recap.producerId?.toString() !== access.userId
    ) {
      throw new NotFoundException('Lead not found.');
    }
    if (
      access.dataScope === DataScope.Branch &&
      branchId &&
      recap.branchId !== branchId
    ) {
      throw new NotFoundException('Lead not found.');
    }
  }

  /**
   * The lead's household, self-healing the missing link.
   *
   * The migration writes only `legacyHouseholdId` on leads — never
   * `householdId` — so without the legacy fallback every migrated lead would be
   * unable to record a recap. Mirrors `ResolveHouseholdStep.findExisting`:
   * each record repairs itself the first time it is touched.
   */
  private async findHousehold(
    lead: LeadDocument,
    access: AccessContext,
  ): Promise<HouseholdDocument | null> {
    if (lead.householdId) {
      const byId = await this.householdModel.findOne({
        _id: lead.householdId,
        agencyId: access.agencyId,
      });
      if (byId) return byId;
    }

    if (lead.legacyHouseholdId) {
      const byLegacy = await this.householdModel.findOne({
        agencyId: access.agencyId,
        legacySmartSuiteId: lead.legacyHouseholdId,
      });
      if (byLegacy) {
        // Fire-and-forget backfill: the next read takes the fast path.
        await this.leadModel
          .updateOne({ _id: lead._id }, { $set: { householdId: byLegacy._id } })
          .catch((error: unknown) => {
            this.logger.warn(
              `Failed to backfill householdId on lead ${lead._id.toString()}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
        return byLegacy;
      }
    }

    return null;
  }

  private async resolveHousehold(
    lead: LeadDocument,
    access: AccessContext,
  ): Promise<HouseholdDocument> {
    const household = await this.findHousehold(lead, access);
    if (household) return household;

    // Deliberately not auto-creating one: that would bypass the contact-first
    // derivation in lead intake, which exists to stop a client acquiring
    // duplicate households.
    throw new ConflictException('This lead is not linked to a household yet.');
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
   * Reject a key that was not issued for this agency and lead.
   *
   * `buildObjectKey` produces `agencies/<agencyId>/quote-recaps/<leadId>/…`, so
   * the prefix test is exact. Without it a caller could hand over any key they
   * knew of — including another agency's object — and have it attached to their
   * own record.
   */
  private assertKeyOwnership(
    key: string,
    agencyId: string,
    leadId: string,
  ): void {
    const prefix = `agencies/${agencyId}/quote-recaps/${leadId}/`;
    if (!key.startsWith(prefix)) {
      throw new BadRequestException('Invalid document key.');
    }
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
