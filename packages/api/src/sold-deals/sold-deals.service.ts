import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  carrierPolicyNumberMatches,
  carrierSlug,
  normalizeLeadStatus,
} from '@sfa/shared';
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
import { CarriersService } from '../carriers/carriers.service';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CrmAssignmentService } from '../crm-rotations/crm-assignment.service';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { LeadAccessService } from '../leads/lead-access.service';
import { policyNumberKey } from '../policies/policy-number';
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
  MAX_SOLD_DOCUMENT_BYTES,
  SOLD_UPLOAD_KINDS,
  soldDocumentPurpose,
  type PresignSoldDocumentDto,
  type SoldUploadKind,
} from './dto/presign-sold-document.dto';
import { auditAttachmentsByItem } from './intake/sold-audit-attachments';
import { collectAttachments } from './intake/sold.normalize';
import { SoldDealIntakeService } from './intake/sold-deal-intake.service';
import { buildSoldSubmissionToken } from './intake/sold.normalize';
import type { SoldIntakeContext } from './intake/sold-intake.types';

/**
 * The allow-list per upload kind, as `HeadObject` enforces it.
 *
 * Derived from `SOLD_UPLOAD_KINDS` rather than re-listed, so the presign
 * narrowing and this verification can never disagree — the presign is a
 * fast-fail, this is the gate.
 */
const ALLOWED_CONTENT_TYPES = Object.fromEntries(
  Object.entries(SOLD_UPLOAD_KINDS).map(([kind, types]) => [
    kind,
    new Set<string>(types),
  ]),
) as Record<SoldUploadKind, Set<string>>;

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
    private readonly carriers: CarriersService,
    private readonly leadAccess: LeadAccessService,
    private readonly storage: StorageService,
    private readonly intake: SoldDealIntakeService,
    private readonly auditGeneration: AuditGenerationService,
    private readonly crmAssignment: CrmAssignmentService,
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

    await this.assertPolicyNumberFormats(dto, tenant.agencyId);
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
   * Does this lead have a quote recap on file? (PAC-56 #17)
   *
   * Backs the "Mark as Sold is disabled until a quote has been given" gate, and
   * lets `/sold/new` block a typed URL rather than trusting the button.
   *
   * ⚠ **The legacy fallback is load-bearing, not defensive.** The migration
   * writes only `legacyLeadId` on recaps — `backfill-deal-refs` repairs deals,
   * never these — so a bare `{ leadId }` probe answers "no recap" for *every*
   * migrated lead, locking all of them out of the wizard. `LeadDetailService
   * .loadQuoteRecaps` carries the same fallback for the same reason, and both
   * indexes exist to serve it.
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
   * Enforce each carrier's policy-number format (PAC-56 #20).
   *
   * **This is the enforcement point.** The wizard validates live off the same
   * catalog rows, but that is an assist — it can be bypassed by a stale bundle,
   * a direct API call, or a carriers fetch that failed open.
   *
   * Three deliberate choices:
   *
   * - Tested against the **normalized key**, so `123-456` satisfies a
   *   digits-only rule. That is the form the number is stored and looked up in;
   *   rejecting punctuation nobody persists would be a rule about typing.
   * - A carrier **absent from the catalog** carries no pattern and passes. That
   *   is the "Other" escape and migrated data, both of which must keep working.
   * - The message quotes the carrier's own hint, because "invalid policy
   *   number" tells a producer nothing about how to fix it.
   */
  private async assertPolicyNumberFormats(
    dto: CreateSoldDealDto,
    agencyId: string,
  ): Promise<void> {
    // Only reach for the catalog if some row could actually be constrained.
    if (dto.policies.length === 0) return;

    const bySlug = await this.carriers.optionsBySlug(agencyId);
    if (bySlug.size === 0) return;

    dto.policies.forEach((policy, index) => {
      const carrier = bySlug.get(carrierSlug(policy.carrier));
      if (!carrier?.policyNumberPattern) return;

      const key = policyNumberKey(policy.policyNumber);
      if (carrierPolicyNumberMatches(carrier.policyNumberPattern, key)) return;

      throw new BadRequestException(
        `Policy ${index + 1}: ${
          carrier.policyNumberHint ??
          `"${policy.policyNumber}" is not a valid ${carrier.name} policy number.`
        }`,
      );
    });
  }

  /**
   * Verify every uploaded document actually landed, and replace the client's claimed
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
    for (const { attachment, kind } of collectAttachments(dto.policies)) {
      /*
       * Reject a key this agency and lead did not produce, before touching
       * storage — otherwise a caller could attach any object they knew of,
       * including another agency's.
       *
       * The purpose now carries the **kind** (PAC-56 #23), so this also rejects
       * a JPEG presigned as a discount proof and then declared as the New
       * Business Application: its key sits under the wrong prefix. The
       * content-type check below is the second, independent gate.
       */
      this.storage.assertKeyOwnership(attachment.key, {
        agencyId,
        purpose: soldDocumentPurpose(leadId, kind),
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
      const allowed = ALLOWED_CONTENT_TYPES[kind];
      if (!stored.contentType || !allowed.has(stored.contentType)) {
        throw new BadRequestException(
          kind === 'new_business_application'
            ? 'The new business application must be a PDF.'
            : 'Documents must be a PDF, JPEG or PNG.',
        );
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
