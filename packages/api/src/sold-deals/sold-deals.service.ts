import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { normalizeLeadStatus } from '@sfa/shared';
import type {
  AccessContext,
  CreateSoldDealResponse,
  SoldDealLeadContext,
  SoldDocumentMeta,
  SoldDocumentPresignResponse,
  SoldHouseholdContact,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AuditGenerationService } from '../audit-generation/audit-generation.service';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CrmAssignmentService } from '../crm-rotations/crm-assignment.service';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { LeadAccessService } from '../leads/lead-access.service';
import { StorageService } from '../storage/storage.service';
import type { HouseholdDocument } from '../households/schemas/household.schema';
import type { LeadDocument } from '../leads/schemas/lead.schema';
import type {
  CreateSoldDealDto,
  SoldDealContextDto,
} from './dto/create-sold-deal.dto';
import {
  ALLOWED_SOLD_DOCUMENT_CONTENT_TYPES,
  MAX_SOLD_DOCUMENT_BYTES,
  soldDocumentPurpose,
  type PresignSoldDocumentDto,
} from './dto/presign-sold-document.dto';
import { collectAttachments } from './intake/sold.normalize';
import { SoldDealIntakeService } from './intake/sold-deal-intake.service';
import { buildSoldSubmissionToken } from './intake/sold.normalize';
import type { SoldIntakeContext } from './intake/sold-intake.types';

const ALLOWED_CONTENT_TYPES = new Set<string>(
  ALLOWED_SOLD_DOCUMENT_CONTENT_TYPES,
);

@Injectable()
export class SoldDealsService {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly leadAccess: LeadAccessService,
    private readonly storage: StorageService,
    private readonly intake: SoldDealIntakeService,
    private readonly auditGeneration: AuditGenerationService,
    private readonly crmAssignment: CrmAssignmentService,
  ) {}

  /**
   * Issue a presigned PUT for a Card 5 proof document.
   *
   * Ownership is checked **first**: a presign is a write, and must not leak the
   * existence of another producer's lead. The key is built from the loaded
   * document's `agencyId`, never from the request, so a caller cannot aim an
   * upload at another agency's prefix.
   */
  async presignDocument(
    access: AccessContext,
    branchId: string | null,
    dto: PresignSoldDocumentDto,
  ): Promise<SoldDocumentPresignResponse> {
    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      dto.leadId,
    );

    const key = this.storage.buildObjectKey({
      agencyId: lead.agencyId,
      purpose: soldDocumentPurpose(lead._id.toString()),
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
   * What the wizard needs on mount: who the sale is for, and which household
   * members can be named as drivers on Card 5.
   *
   * Mirrors `GET /quote-recaps/context`, including the decision to report a
   * missing household as `householdId: null` rather than a 409 — the page can
   * then block up front instead of letting a producer fill eight cards and fail
   * at submit.
   */
  async getLeadContext(
    access: AccessContext,
    branchId: string | null,
    query: SoldDealContextDto,
  ): Promise<SoldDealLeadContext> {
    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      query.leadId,
    );
    const household = await this.leadAccess.findHousehold(lead, access);

    return {
      leadId: lead._id.toString(),
      primaryContactName: this.leadName(lead),
      householdId: household?._id.toString() ?? null,
      householdName: household?.name ?? null,
      contacts: household ? await this.householdContacts(household) : [],
      leadStatus: normalizeLeadStatus(lead.status),
    };
  }

  /** Record the sale. Every total is derived server-side from the policy rows. */
  async create(
    access: AccessContext,
    branchId: string | null,
    dto: CreateSoldDealDto,
  ): Promise<CreateSoldDealResponse> {
    const tenant = await this.tenancy.resolve(access, branchId);
    const token = buildSoldSubmissionToken(dto.submissionToken);

    // Clamp a replayed token against the *found* deal before doing any work, so
    // a token replayed by another producer 404s rather than handing back
    // someone else's deal id.
    if (token) {
      const existing = await this.intake.loadByToken(tenant.agencyId, token);
      if (existing) {
        this.leadAccess.assertOwned(existing, access, branchId);
      }
    }

    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      dto.leadId,
    );
    const household = await this.leadAccess.resolveHousehold(lead, access);

    await this.verifyAttachments(dto, tenant.agencyId, lead._id.toString());

    const ctx: SoldIntakeContext = {
      agencyId: tenant.agencyId,
      branchId: tenant.branchId,
      producerId: new Types.ObjectId(access.userId),
      leadId: lead._id,
      householdId: household._id,
      quoteRecapId: dto.quoteRecapId
        ? new Types.ObjectId(dto.quoteRecapId)
        : undefined,
      primaryContactId: household.primaryContactId,
      clientName: this.clientName(lead, household),
      submissionToken: token,
    };

    const outcome = await this.intake.process(ctx, dto, access, lead);
    const { leadStatus } = await this.intake.recordSideEffects(ctx, outcome);

    /*
     * The hand-off. Both run **post-commit and best-effort**: the deal is
     * booked either way, and failing the request now would tell a producer
     * their sale did not happen when it did.
     *
     * Deliberately run on the replay path too. Generation is idempotent (the
     * partial-unique `dedupeKey` index) and CRM assignment is anchored on the
     * household, so re-running them is how a request that committed the deal
     * and then died self-heals on retry.
     */
    const audit = await this.auditGeneration.generateForDeal({
      agencyId: ctx.agencyId,
      branchId: ctx.branchId,
      dealId: outcome.dealId,
      producerId: ctx.producerId,
      producerName: await this.producerName(ctx.producerId),
      clientName: ctx.clientName,
      submissionToken: ctx.submissionToken,
    });

    const crm = await this.crmAssignment.assignForDeal({
      agencyId: ctx.agencyId,
      branchId: ctx.branchId,
      dealId: outcome.dealId,
      householdId: ctx.householdId,
      producerId: ctx.producerId,
    });

    return {
      id: outcome.dealId.toString(),
      leadId: ctx.leadId.toString(),
      premium: outcome.premium,
      itemCount: outcome.itemCount,
      policyCount: outcome.policyCount,
      policyTypes: outcome.policyTypes,
      dealType: outcome.dealType,
      isBundle: outcome.isBundle,
      soldDate: outcome.soldDate.toISOString(),
      leadStatus,
      auditItemCount: audit.itemCount,
      crmAssigned:
        crm.status === 'assigned' || crm.status === 'skipped_existing',
    };
  }

  /**
   * Verify every Card 5 proof actually landed, and replace the client's claimed
   * `contentType` / `size` with what storage reports.
   *
   * The presigned PUT signs only the content type, so the declared size in the
   * body is a claim rather than evidence — a caller holding a valid URL can
   * upload a 5 GB file. `HeadObject` is the only server-side proof of what was
   * really stored, which is what makes the limits enforced rather than
   * advisory.
   *
   * Mutates the DTO in place so the steps downstream persist the verified
   * values; anything else would leave the client's numbers in the database.
   */
  private async verifyAttachments(
    dto: CreateSoldDealDto,
    agencyId: string,
    leadId: string,
  ): Promise<void> {
    for (const attachment of collectAttachments(dto.policies)) {
      // Reject a key this agency and lead did not produce, before touching
      // storage — otherwise a caller could attach any object they knew of,
      // including another agency's.
      this.storage.assertKeyOwnership(attachment.key, {
        agencyId,
        purpose: soldDocumentPurpose(leadId),
      });

      const stored = await this.storage.statObject(attachment.key);
      if (!stored) {
        throw new NotFoundException(
          'An uploaded document was not found in storage.',
        );
      }
      if (stored.size > MAX_SOLD_DOCUMENT_BYTES) {
        throw new BadRequestException('A document is larger than 10MB.');
      }
      if (
        !stored.contentType ||
        !ALLOWED_CONTENT_TYPES.has(stored.contentType)
      ) {
        throw new BadRequestException('Documents must be a PDF, JPEG or PNG.');
      }

      this.applyVerifiedMeta(attachment, stored);
    }
  }

  private applyVerifiedMeta(
    attachment: SoldDocumentMeta,
    stored: { contentType: string | null; size: number },
  ): void {
    attachment.contentType = stored.contentType ?? attachment.contentType;
    attachment.size = stored.size;
  }

  /**
   * The producer's display name, denormalised onto each generated audit item.
   *
   * Parity with what the migration writes — the board reads `clientName` to
   * render a row, but `producerName` is what makes a migrated item and a
   * generated one look the same in any other view.
   */
  private async producerName(
    producerId: Types.ObjectId,
  ): Promise<string | undefined> {
    const user = await this.userModel
      .findById(producerId)
      .select('firstName lastName');
    if (!user) return undefined;
    return (
      [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
      undefined
    );
  }

  /** Household members the producer can name as defensive drivers. */
  private async householdContacts(
    household: HouseholdDocument,
  ): Promise<SoldHouseholdContact[]> {
    const ids = [
      household.primaryContactId,
      ...(household.memberContactIds ?? []),
    ].filter((id): id is Types.ObjectId => Boolean(id));

    if (!ids.length) return [];

    const contacts = await this.contactModel
      .find({ _id: { $in: ids }, agencyId: household.agencyId })
      .select('firstName lastName roleInHousehold')
      .lean<
        Array<{
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
          roleInHousehold?: string;
        }>
      >();

    return contacts.map((contact) => ({
      id: contact._id.toString(),
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      roleInHousehold: contact.roleInHousehold,
    }));
  }

  private leadName(lead: LeadDocument): string {
    return (
      [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() ||
      'Unnamed lead'
    );
  }

  /**
   * The deal's client name, which the hand-off board renders directly — a deal
   * without one shows every generated audit item as "Unknown Client".
   */
  private clientName(
    lead: LeadDocument,
    household: HouseholdDocument,
  ): string | undefined {
    return (
      household.primaryContactName?.trim() ||
      household.name?.trim() ||
      this.leadName(lead)
    );
  }
}
