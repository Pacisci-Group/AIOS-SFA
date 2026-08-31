import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DataScope, normalizeLeadStatus } from '@sfa/shared';
import type {
  AccessContext,
  CreateSoldDealResponse,
  SoldDealLeadContext,
  SoldDocumentPresignResponse,
  SoldHouseholdContact,
  SoldStaffOption,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuditGenerationService } from '../audit-generation/audit-generation.service';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CrmAssignmentService } from '../crm-rotations/crm-assignment.service';
import { LeadTicketsService } from '../crm/lead-tickets.service';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { LeadAccessService } from '../leads/lead-access.service';
import {
  QuoteRecap,
  QuoteRecapDocument,
} from '../quote-recaps/schemas/quote-recap.schema';
import { StorageService } from '../storage/storage.service';
import type { HouseholdDocument } from '../households/schemas/household.schema';
import type { LeadDocument } from '../leads/schemas/lead.schema';
import type {
  CreateSoldDealDto,
  SoldDealContextDto,
} from './dto/create-sold-deal.dto';
import {
  soldDocumentPurpose,
  type PresignSoldDocumentDto,
} from './dto/presign-sold-document.dto';
import { auditAttachmentsByItem } from './intake/sold-audit-attachments';
import { SoldDealIntakeService } from './intake/sold-deal-intake.service';
import { SoldSubmissionValidator } from './intake/sold-submission.validator';
import { buildSoldSubmissionToken } from './intake/sold.normalize';
import type { SoldIntakeContext } from './intake/sold-intake.types';

@Injectable()
export class SoldDealsService {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecapDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly leadAccess: LeadAccessService,
    private readonly storage: StorageService,
    private readonly intake: SoldDealIntakeService,
    private readonly submissions: SoldSubmissionValidator,
    private readonly auditGeneration: AuditGenerationService,
    private readonly crmAssignment: CrmAssignmentService,
    private readonly leadTickets: LeadTicketsService,
  ) {}

  /**
   * Issue a presigned PUT for a sold-form document.
   *
   * Ownership is checked **first**: a presign is a write, and must not leak the
   * existence of another producer's lead. The key is built from the loaded
   * document's `agencyId`, never from the request, so a caller cannot aim an
   * upload at another agency's prefix.
   *
   * `kind` puts the New Business Application under its own key prefix (PAC-56
   * #23), which is what makes `assertKeyOwnership` enforce the PDF-only rule at
   * verification time rather than trusting this narrowing.
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
      purpose: soldDocumentPurpose(lead._id.toString(), dto.kind),
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
   * members can be named as defensive drivers.
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
      hasQuoteRecap: await this.hasQuoteRecap(lead),
    };
  }

  /** Record the sale. Every total is derived server-side from the policy rows. */
  /**
   * The agency's staff, for the "Cancelled by → SFA staff" picker (PAC-65 #11).
   *
   * Served from this controller rather than reusing `GET /users`, which is
   * gated on `agency:users:read` — a permission the Producer role does not
   * hold, so the producer filling in this very form would 403 on it. Riding the
   * `deal_audits` read gate they already passed to reach the wizard is the same
   * move `GET /crm/service-tickets/assignees` makes for a CSR.
   *
   * Unlike that endpoint this does **not** filter by role: "who cancelled the
   * policy" can be anyone in the agency, and a role-filtered list would quietly
   * make the true answer unpickable.
   */
  async listStaff(
    access: AccessContext,
    branchId: string | null,
  ): Promise<SoldStaffOption[]> {
    const tenant = await this.tenancy.resolve(access, branchId);

    const filter: FilterQuery<UserDocument> = {
      agencyId: new Types.ObjectId(tenant.agencyId),
      isPlatformAdmin: { $ne: true },
      isActive: { $ne: false },
    };
    // Agency-wide scopes see everyone; narrower scopes stay inside the branch.
    if (access.dataScope !== DataScope.Agency && tenant.branchId) {
      filter.branchId = new Types.ObjectId(tenant.branchId);
    }

    const users = await this.userModel
      .find(filter)
      .select('firstName lastName email')
      .sort({ firstName: 1, lastName: 1 })
      .lean();

    return users.map((user) => ({
      id: String(user._id),
      name:
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.email ||
        'Unknown',
      email: user.email,
    }));
  }

  /**
   * Check every `cancellation.cancelledByUserId` belongs to this agency.
   *
   * ⚠ Without this the field is a **cross-agency write primitive**: the id is
   * client-supplied and lands on a stored record, so an attacker could name a
   * user from another tenant as having cancelled a policy. Exactly the trap
   * `existingPolicyId` documents, and the reason `listStaff` above is scoped.
   */
  private async resolveCancelledBy(
    dto: CreateSoldDealDto,
    agencyId: string,
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        dto.policies
          .map((policy) => policy.cancellation?.cancelledByUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!ids.length) return new Map();

    // Agency-scoped by the query, so an id from another tenant simply is not
    // found and the count check below rejects the whole submission.
    const users = await this.userModel
      .find({
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        agencyId: new Types.ObjectId(agencyId),
      })
      .select('firstName lastName email')
      .lean();

    if (users.length !== ids.length) {
      throw new BadRequestException('Unknown staff member on a cancellation.');
    }

    // The names come back from the same round trip, so the intake step can
    // denormalize them without a second query inside the transaction.
    return new Map(
      users.map((user) => [
        String(user._id),
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
          user.email ||
          'Unknown',
      ]),
    );
  }

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

    await this.submissions.assertPolicyNumberFormats(dto, tenant.agencyId);
    const staffNameById = await this.resolveCancelledBy(dto, tenant.agencyId);
    // The lead is the key anchor on this path; a policy transfer passes its
    // household instead. Same verification, different prefix.
    await this.submissions.verifyAttachments(dto, tenant.agencyId, (kind) =>
      soldDocumentPurpose(lead._id.toString(), kind),
    );

    const ctx: SoldIntakeContext = {
      agencyId: tenant.agencyId,
      branchId: tenant.branchId,
      producerId: new Types.ObjectId(access.userId),
      leadId: lead._id,
      // The Sold form is, by definition, the new-business path. A company
      // transfer reaches the same pipeline through the CRM ticket instead.
      businessType: 'new_business',
      householdId: household._id,
      // Resolved and agency-checked above; the prior-insurance step reads it
      // rather than querying users inside the transaction.
      staffNameById,
      quoteRecapId: dto.quoteRecapId
        ? new Types.ObjectId(dto.quoteRecapId)
        : undefined,
      primaryContactId: household.primaryContactId,
      clientName: this.clientName(lead, household),
      submissionToken: token,
    };

    const outcome = await this.intake.process(
      ctx,
      dto,
      access,
      lead.leadSource,
    );
    const { leadStatus } = await this.intake.recordSideEffects(ctx, outcome);

    /*
     * The sale just advanced the lead to Sold, which finishes any quote service
     * ticket opened for it from Start Quote. Idempotent and best-effort like the
     * two below, and deliberately keyed off the status `recordSideEffects`
     * actually landed on rather than assuming Sold — a lead already terminal is
     * left exactly as it was.
     */
    await this.leadTickets.resolveForLead(lead._id, ctx.agencyId, leadStatus);

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
      // Built *after* `verifyAttachments`, so what gets persisted is the size
      // and content type storage reported, not the client's claim.
      attachmentsByItem: auditAttachmentsByItem(dto.policies),
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
      leadId: lead._id.toString(),
      premium: outcome.premium,
      itemCount: outcome.itemCount,
      policyCount: outcome.policyCount,
      policyTypes: outcome.policyTypes,
      dealType: outcome.dealType,
      isBundle: outcome.isBundle,
      soldDate: outcome.soldDate.toISOString(),
      // Non-null on this path: the Sold form always carries a lead, so
      // `recordSideEffects` always ran the advance. The nullable return exists
      // for the leadless policy-transfer path, which does not use this response.
      leadStatus: leadStatus ?? '',
      auditItemCount: audit.itemCount,
      crmAssigned:
        crm.status === 'assigned' || crm.status === 'skipped_existing',
    };
  }

  /**
   * Does this lead have a quote recap on file? (PAC-56 #17)
   *
   * Backs the "Mark as Sold is disabled until a quote has been given" gate, and
   * lets `/sold/new` block a typed URL rather than trusting the button.
   *
   * ⚠ **The legacy fallback is load-bearing, not defensive.** A recap imported
   * before the migration resolved `leadId` carries only `legacyLeadId`, so a
   * bare `{ leadId }` probe answers "no recap" for such leads and locks them out
   * of the wizard. `LeadDetailService.loadQuoteRecaps` carries the same fallback
   * for the same reason, and both indexes exist to serve it.
   *
   * Unlike that one this does not backfill: it is a read on a gate, and
   * viewing the lead page (which does backfill) is how anyone arrives here.
   */
  private async hasQuoteRecap(lead: LeadDocument): Promise<boolean> {
    const agencyId = lead.agencyId;
    const byRef = await this.quoteRecapModel.exists({
      agencyId,
      leadId: lead._id,
      isTestRecord: { $ne: true },
    });
    if (byRef) return true;

    if (!lead.legacySmartSuiteId) return false;

    const byLegacy = await this.quoteRecapModel.exists({
      agencyId,
      legacyLeadId: lead.legacySmartSuiteId,
      isTestRecord: { $ne: true },
    });
    return Boolean(byLegacy);
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
