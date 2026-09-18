import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_DEAL_AUDIT_STATUS,
  DataScope,
  normalizeDealAuditStatus,
  normalizeLeadStatus,
  normalizePolicyType,
} from '@sfa/shared';
import type {
  AccessContext,
  AddSoldDealPoliciesResponse,
  CreateSoldDealResponse,
  DealAuditStatus,
  SoldDealAddPoliciesBlock,
  SoldDealEditView,
  SoldDealLeadContext,
  SoldDocumentPresignResponse,
  SoldHouseholdContact,
  SoldStaffOption,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  ChangeSnapshot,
  changeDate,
  diffSnapshots,
  snapshot,
} from '../activities/change-log';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { AuditGenerationService } from '../audit-generation/audit-generation.service';
import { contactDisplayName } from '../contacts/contact-details';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { DealAudit } from '../deal-audits/schemas/deal-audit.schema';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import { policyNumberKey } from '../policies/policy-number';
import { toLeadDetailPolicy } from '../policies/policy-view';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import { CrmAssignmentService } from '../crm-rotations/crm-assignment.service';
import { LeadTicketsService } from '../crm/lead-tickets.service';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { LeadAccessService } from '../leads/lead-access.service';
import {
  QuoteRecap,
  QuoteRecapDocument,
} from '../quote-recaps/schemas/quote-recap.schema';
import { StorageService } from '../storage/storage.service';
import {
  HouseholdMembersService,
  rolesByContact,
} from '../households/household-members.service';
import {
  Household,
  type HouseholdDocument,
} from '../households/schemas/household.schema';
import {
  replacementIntentOf,
  type LeadDocument,
} from '../leads/schemas/lead.schema';
import { PolicyRewritesService } from '../policies/policy-rewrites.service';
import type {
  CreateSoldDealDto,
  SoldDealContextDto,
  SoldIntakeDto,
  SoldIntakePolicy,
} from './dto/create-sold-deal.dto';
import type {
  AddSoldDealPoliciesDto,
  UpdateSoldDealDto,
} from './dto/edit-sold-deal.dto';
import { DEAL_CHANGE_FIELDS, type DealChangeSubject } from './deal-change-log';
import {
  soldDocumentPurpose,
  type PresignSoldDocumentDto,
} from './dto/presign-sold-document.dto';
import { auditAttachmentsByItem } from './intake/sold-audit-attachments';
import { SoldDealIntakeService } from './intake/sold-deal-intake.service';
import { SoldSubmissionValidator } from './intake/sold-submission.validator';
import { SoldDealAmendmentService } from './intake/sold-deal-amendment.service';
import {
  buildSoldAdditionToken,
  buildSoldSubmissionToken,
  parseFormDate,
  soldDateYmd,
} from './intake/sold.normalize';
import type { SoldIntakeContext } from './intake/sold-intake.types';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** What the Edit sale page — and the 409 — say about a blocked addition. */
const ADD_POLICIES_BLOCK_MESSAGES: Record<SoldDealAddPoliciesBlock, string> = {
  audit_submitted:
    "This sale's audit has already been submitted. It has to be sent back before a policy can be added.",
  no_lead:
    'This sale is not linked to a lead, so policies cannot be added to it here.',
  no_household:
    'This sale is not linked to a household, so policies cannot be added to it.',
};

@Injectable()
export class SoldDealsService {
  private readonly logger = new Logger(SoldDealsService.name);

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
    private readonly memberships: HouseholdMembersService,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    @InjectModel(DealAudit.name)
    private readonly dealAuditModel: Model<DealAudit>,
    private readonly amendments: SoldDealAmendmentService,
    /*
     * Finishes a replacement booked through this form — the chargeback on a
     * Cancel Rewrite, and stamping the lead's intent consumed — both inside the
     * deal's own transaction (PAC-126).
     */
    private readonly replacements: PolicyRewritesService,
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
      replacementReason: replacementIntentOf(lead)?.reason ?? null,
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
    dto: { policies: SoldIntakePolicy[] },
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

    /*
     * Is this lead a replacement? (PAC-126)
     *
     * A Cancel Rewrite and a Company Transfer run through this very path, so the
     * lead carries the answer and the submit applies it. Read here rather than
     * taken from the request: the client sends the same body either way, and
     * letting it declare "this is a rewrite" would let anyone retire any policy
     * their scope can reach, chargeback and all.
     *
     * Because this is read on **every** submit for the lead, there is no way to
     * book an ordinary sale on a replacement lead and quietly skip the
     * retirement — which is the failure the whole design has to avoid.
     */
    const replacement = replacementIntentOf(lead);

    const ctx: SoldIntakeContext = {
      agencyId: tenant.agencyId,
      branchId: tenant.branchId,
      producerId: new Types.ObjectId(access.userId),
      leadId: lead._id,
      /*
       * The Sold form is the new-business path — except when the lead exists to
       * move a client within their own book.
       *
       * A **Company Transfer is not production**: nothing was sold, so it is
       * booked `company_transfer` and `PerformanceService` never counts it. A
       * **Cancel Rewrite is** a real sale and stays `new_business`; what it does
       * to the producer's figures is the chargeback's business, not this field's.
       * `RETIRED_POLICY_STATUS` and `rewriteFinancialOutcome` are where that
       * split is actually defined.
       */
      businessType:
        replacement?.reason === 'company_transfer'
          ? 'company_transfer'
          : 'new_business',
      // Why the *original* is going away — distinct from `businessType`, which
      // describes the replacement. `UpsertPoliciesStep.retireTransferred` reads
      // this to decide the retired policy's status.
      replacementReason: replacement?.reason,
      householdId: household._id,
      // Resolved and agency-checked above; the prior-insurance step reads it
      // rather than querying users inside the transaction.
      staffNameById,
      quoteRecapId: dto.quoteRecapId
        ? new Types.ObjectId(dto.quoteRecapId)
        : undefined,
      primaryContactId: household.primaryContactId,
      clientName: await this.clientName(lead, household),
      submissionToken: token,
    };

    /*
     * `fromPolicyId` goes on the **first** policy row only, injected here rather
     * than accepted from the client for the same reason as `replacementReason`.
     *
     * One policy is being replaced, so exactly one row may claim to replace it:
     * on every row it would retire the same policy N times and leave
     * `transferredToPolicyId` pointing at whichever was written last. A
     * replacement that splits one policy into two (an Auto becoming Auto +
     * Motorcycle) is a real case — the extra rows are simply new policies on the
     * same new deal.
     */
    const intakeDto: CreateSoldDealDto = replacement
      ? {
          ...dto,
          policies: dto.policies.map((row, index) =>
            index === 0
              ? { ...row, fromPolicyId: String(replacement.policyId) }
              : row,
          ),
        }
      : dto;

    const outcome = await this.intake.process(
      ctx,
      intakeDto,
      access,
      lead.leadSource,
      replacement
        ? // Inside the transaction. A replacement written without its chargeback
          // keeps credit that was clawed back, and a replacement written without
          // the intent stamped consumed can be booked a second time from the
          // resume path — neither would ever be detected.
          async (deps, policies, dealId) => {
            await this.replacements.recordForLead({
              deps,
              lead,
              intent: replacement,
              replacementPolicyId: policies[0]?.policyId ?? null,
              dealId,
              soldDate: dto.soldDate,
            });
          }
        : undefined,
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

  // ---------------------------------------------------------------------------
  // Editing a booked sale (PAC-104)
  // ---------------------------------------------------------------------------

  /**
   * `GET /sold-deals/:id` — the Edit sale page: the deal, the policies it
   * holds, and whether it can take another.
   */
  async getEditView(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
  ): Promise<SoldDealEditView> {
    const deal = await this.loadOwnedDeal(access, branchId, dealId);
    return this.buildEditView(deal);
  }

  /**
   * `PATCH /sold-deals/:id` — correct the sold date (PAC-104).
   *
   * ## What moves
   *
   * `soldDate` and `soldDateYmd` move **together**, in one write. The Sold
   * scorecard and the leaderboard bucket on the integer at query time, so the
   * deal simply lands in the new period — the correction the producer asked
   * for, and a reported figure that changes after the fact, which is intended.
   *
   * The deal's `sold` timeline row moves with it: its meaning is "occurred on
   * the sold date", and a correction that left it behind would have the
   * timeline and the Sold card disagree about when the sale happened. The
   * correction itself is timestamped *now*, by the change-log row.
   *
   * ## What deliberately does not
   *
   *   - **Audit items.** `dueAt` counts from when an item was raised
   *     (`audit-due.ts`), not from the sale, and the "Correct Sold Date" item is
   *     left as it is — decided with the product owner; the edit log is the
   *     record.
   *   - **Policies and renewal anchors.** `renewalDate` derives from each
   *     policy's own effective date, never from the sale.
   *
   * Allowed on migrated deals: a date is a single fact, and nothing about a
   * SmartSuite rollup makes it less correctable.
   */
  async updateSoldDate(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
    dto: UpdateSoldDealDto,
  ): Promise<SoldDealEditView> {
    const deal = await this.loadOwnedDeal(access, branchId, dealId);
    const policies = await this.loadDealPolicies(deal);

    // A Save with the date unchanged: nothing to write, nothing to log.
    if (changeDate(deal.soldDate) === dto.soldDate) {
      return this.buildEditView(deal, policies);
    }

    const before = snapshot(DEAL_CHANGE_FIELDS, { deal, policies });
    const soldDate = parseFormDate(dto.soldDate);
    const ymd = soldDateYmd(dto.soldDate);

    await this.dealModel.updateOne(
      { _id: deal._id, agencyId: deal.agencyId },
      { $set: { soldDate, soldDateYmd: ymd } },
    );
    // Mirrored onto the loaded document for the log and the response, rather
    // than re-read. Never saved — the update above is the write.
    deal.soldDate = soldDate;
    deal.soldDateYmd = ymd;

    await this.moveSoldActivity(deal, soldDate);
    await this.recordDealChanges(
      access,
      deal,
      before,
      { deal, policies },
      'Sold deal edited',
    );

    return this.buildEditView(deal, policies);
  }

  /**
   * `POST /sold-deals/:id/policies` — add policies to a booked deal (PAC-104).
   *
   * The Sold form's own policy rows, rules and uploads, written by the create
   * pipeline's own steps (`SoldDealAmendmentService`). What differs from create
   * is everything that already exists: the deal, its policies, its
   * prior-insurance summary and its audit.
   *
   * ## Refused (409) when
   *
   *   - **the audit has been submitted** (`Pending` / `Pass` / `Fail`). The new
   *     policy's items would land on a checklist a reviewer has already ruled
   *     on — decided with the product owner: block, rather than reopen;
   *   - the deal has **no lead** (uploads are keyed on it) or **no household**
   *     (every policy row is written against it).
   *
   * Migrated deals are **allowed**, and their totals are recomputed from the
   * policies linked to them — also the product owner's call. The Edit sale page
   * warns first, because a SmartSuite rollup may count rows this database never
   * received.
   *
   * ## Scope follows the deal, not the caller
   *
   * `producerId` and `branchId` are the deal's. A manager adding a policy to a
   * producer's sale must not move its new audit items — which the hand-off
   * board scopes on `producerId` — out of that producer's view.
   */
  async addPolicies(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
    dto: AddSoldDealPoliciesDto,
  ): Promise<AddSoldDealPoliciesResponse> {
    const deal = await this.loadOwnedDeal(access, branchId, dealId);
    const token = buildSoldAdditionToken(dto.submissionToken);

    // A retry of an addition that already landed. Checked before the blocks
    // below, so the retry still succeeds if the audit has moved on since.
    if (deal.policyAdditionTokens?.includes(token)) {
      return this.additionResponse(deal, true);
    }

    const block = this.addPoliciesBlock(deal, await this.loadAuditStatus(deal));
    if (block) throw new ConflictException(ADD_POLICIES_BLOCK_MESSAGES[block]);
    // Both present: `addPoliciesBlock` returns a reason otherwise.
    const leadId = deal.leadId as Types.ObjectId;
    const householdId = deal.householdId as Types.ObjectId;

    const stored = await this.loadDealPolicies(deal);
    this.assertNotOnDeal(dto, stored);
    await this.assertNotOnAnotherDeal(dto, deal);

    // The steps are typed on the create pipeline's DTO. None of them reads the
    // sold date; it is carried only so the shape is honest.
    const intakeDto: SoldIntakeDto = {
      soldDate: changeDate(deal.soldDate) ?? '',
      policies: dto.policies,
      submissionToken: dto.submissionToken,
    };

    await this.submissions.assertPolicyNumberFormats(intakeDto, deal.agencyId);
    const staffNameById = await this.resolveCancelledBy(
      intakeDto,
      deal.agencyId,
    );
    // Keyed on the deal's lead, which is where the page presigned them — the
    // same verification, and the same prefix, as booking the sale.
    await this.submissions.verifyAttachments(intakeDto, deal.agencyId, (kind) =>
      soldDocumentPurpose(leadId.toString(), kind),
    );

    const before = snapshot(DEAL_CHANGE_FIELDS, { deal, policies: stored });
    // A migrated deal whose producer never resolved has none; the caller is
    // then the only person its new items can reasonably reach.
    const producerId = deal.producerId ?? new Types.ObjectId(access.userId);

    const ctx: SoldIntakeContext = {
      agencyId: deal.agencyId,
      branchId: deal.branchId,
      producerId,
      leadId,
      businessType: deal.businessType,
      householdId,
      staffNameById,
      quoteRecapId: deal.quoteRecapId,
      primaryContactId: deal.primaryContactId,
      clientName: deal.clientName,
      submissionToken: token,
    };

    const outcome = await this.amendments.addPolicies(
      ctx,
      deal._id,
      intakeDto,
      access,
    );
    const fresh = (await this.dealModel.findById(deal._id)) ?? deal;
    if (outcome.replayed) return this.additionResponse(fresh, true);

    const policies = await this.loadDealPolicies(fresh);
    await this.recordDealChanges(
      access,
      fresh,
      before,
      { deal: fresh, policies },
      'Policy added to sold deal',
      // Which policy, when there is exactly one to name.
      outcome.addedPolicyIds.length === 1
        ? outcome.addedPolicyIds[0]
        : undefined,
    );
    await this.recountActivePolicies(fresh.agencyId, householdId);

    /*
     * Post-commit and best-effort, exactly as on create. Additive: items are
     * upserted with `$setOnInsert` by dedupe key, so every item the deal already
     * has — resolved or not — is left exactly as it was, and only the titles the
     * new policies make required are inserted.
     */
    const audit = await this.auditGeneration.generateForDeal({
      agencyId: fresh.agencyId,
      branchId: fresh.branchId,
      dealId: fresh._id,
      producerId,
      producerName: await this.producerName(producerId),
      clientName: fresh.clientName,
      submissionToken: token,
      attachmentsByItem: auditAttachmentsByItem(
        dto.policies,
        fresh.policyTypes,
      ),
    });

    return {
      deal: await this.buildEditView(fresh, policies),
      addedPolicyIds: outcome.addedPolicyIds.map((id) => id.toString()),
      auditItemCount: audit.itemCount,
      replayed: false,
    };
  }

  /**
   * Load a deal inside the caller's agency and clamp it to their data scope,
   * 404-ing rather than 403-ing — the rule `loadOwnedLead` applies to a lead.
   *
   * A **company transfer** is a 404 here too: it has no lead, its uploads are
   * keyed on a household, and it is corrected from the CRM ticket it was
   * recorded on. The Edit sale page is reached from a lead.
   */
  private async loadOwnedDeal(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
  ): Promise<DealDocument> {
    if (!OBJECT_ID.test(dealId)) throw new NotFoundException('Deal not found.');

    const deal = await this.dealModel.findOne({
      _id: new Types.ObjectId(dealId),
      agencyId: access.agencyId,
      isTestRecord: { $ne: true },
      businessType: { $ne: 'company_transfer' },
    });
    if (!deal) throw new NotFoundException('Deal not found.');

    this.leadAccess.assertOwned(deal, access, branchId, 'Deal not found.');
    return deal;
  }

  /** The deal's policies, in a stable order. */
  private loadDealPolicies(deal: DealDocument): Promise<PolicyDocument[]> {
    return this.policyModel
      .find({
        agencyId: deal.agencyId,
        dealId: deal._id,
        isTestRecord: { $ne: true },
      })
      .sort({ effectiveDate: 1, _id: 1 })
      .exec();
  }

  /**
   * The furthest the deal's audit has got, or `null` when it has none.
   *
   * Every parent row is read, not just one: `dealAudits` is non-unique on
   * `{agencyId, dealId}` because migrated data can hold several, and a deal any
   * one of which has been submitted counts as submitted.
   */
  private async loadAuditStatus(
    deal: DealDocument,
  ): Promise<DealAuditStatus | null> {
    const audits = await this.dealAuditModel
      .find({ agencyId: deal.agencyId, dealId: deal._id })
      .select('auditStatus')
      .lean<Array<{ auditStatus?: string }>>();
    if (!audits.length) return null;

    return (
      audits
        .map((audit) => normalizeDealAuditStatus(audit.auditStatus))
        .find((status) => status !== DEFAULT_DEAL_AUDIT_STATUS) ??
      DEFAULT_DEAL_AUDIT_STATUS
    );
  }

  private addPoliciesBlock(
    deal: DealDocument,
    auditStatus: DealAuditStatus | null,
  ): SoldDealAddPoliciesBlock | null {
    if (auditStatus && auditStatus !== DEFAULT_DEAL_AUDIT_STATUS) {
      return 'audit_submitted';
    }
    if (!deal.leadId) return 'no_lead';
    if (!deal.householdId) return 'no_household';
    return null;
  }

  private async buildEditView(
    deal: DealDocument,
    policies?: PolicyDocument[],
  ): Promise<SoldDealEditView> {
    const [rows, household, auditStatus, producerName] = await Promise.all([
      policies ?? this.loadDealPolicies(deal),
      deal.householdId
        ? this.householdModel.findOne({
            _id: deal.householdId,
            agencyId: deal.agencyId,
          })
        : Promise.resolve(null),
      this.loadAuditStatus(deal),
      deal.producerId
        ? this.producerName(deal.producerId)
        : Promise.resolve(undefined),
    ]);
    const block = this.addPoliciesBlock(deal, auditStatus);

    return {
      id: deal._id.toString(),
      leadId: deal.leadId?.toString() ?? null,
      householdId: deal.householdId?.toString() ?? null,
      householdName: household?.name ?? null,
      clientName:
        deal.clientName?.trim() || household?.name?.trim() || 'Unnamed client',
      producerName: producerName ?? null,
      soldDate: changeDate(deal.soldDate),
      premium: deal.premium ?? 0,
      itemCount: deal.itemCount ?? 0,
      policyCount: deal.policyCount ?? 0,
      policyTypes: (deal.policyTypes ?? [])
        .map((value) => normalizePolicyType(value))
        .filter(Boolean),
      dealType: deal.dealType ?? 'Other',
      isBundle: deal.isBundle ?? false,
      policies: rows.map((policy) => toLeadDetailPolicy(policy)),
      contacts: household ? await this.householdContacts(household) : [],
      auditStatus,
      isMigrated: Boolean(deal.legacySmartSuiteId),
      canAddPolicies: block === null,
      addPoliciesBlockedBy: block,
    };
  }

  private async additionResponse(
    deal: DealDocument,
    replayed: boolean,
  ): Promise<AddSoldDealPoliciesResponse> {
    return {
      deal: await this.buildEditView(deal),
      addedPolicyIds: [],
      auditItemCount: deal.auditItemCount ?? 0,
      replayed,
    };
  }

  /**
   * 400 for a row already on this deal — by id, or by policy number.
   *
   * `refinePolicyBatch` catches a number repeated *within* the request; it
   * cannot see what the deal already holds, and adding a policy twice would
   * double its premium on the Sold scorecard.
   */
  private assertNotOnDeal(
    dto: AddSoldDealPoliciesDto,
    stored: PolicyDocument[],
  ): void {
    const ids = new Set(stored.map((policy) => policy._id.toString()));
    const numbers = new Set(
      stored
        .map((policy) => policyNumberKey(policy.policyNumber))
        .filter(Boolean),
    );

    dto.policies.forEach((row, index) => {
      const onDeal = row.existingPolicyId
        ? ids.has(row.existingPolicyId)
        : numbers.has(policyNumberKey(row.policyNumber));
      if (onDeal) {
        throw new BadRequestException(
          `Policy ${index + 1}: ${row.policyNumber} is already on this sale.`,
        );
      }
    });
  }

  /**
   * 409 for an `existingPolicyId` that belongs to **another** deal.
   *
   * Re-pointing it — which is what `UpsertPoliciesStep` does with a confirmed
   * duplicate — would silently take it off that sale and leave its totals
   * counting a policy it no longer holds. That is a removal, and a booked sale
   * does not allow one. A policy on no deal at all (migrated, never sold
   * through the app) is still claimable, exactly as on create.
   */
  private async assertNotOnAnotherDeal(
    dto: AddSoldDealPoliciesDto,
    deal: DealDocument,
  ): Promise<void> {
    const ids = dto.policies
      .map((row) => row.existingPolicyId)
      .filter((id): id is string => Boolean(id));
    if (!ids.length) return;

    const attached = await this.policyModel.exists({
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
      agencyId: deal.agencyId,
      dealId: { $nin: [null, deal._id] },
    });
    if (attached) {
      throw new ConflictException(
        'That policy is already on another sale. Correct it there instead.',
      );
    }
  }

  /** Best-effort: the date is already corrected, which is what was asked for. */
  private async moveSoldActivity(
    deal: DealDocument,
    soldDate: Date,
  ): Promise<void> {
    try {
      await this.activityModel.updateMany(
        { agencyId: deal.agencyId, dealId: deal._id, type: 'sold' },
        { $set: { occurredAt: soldDate } },
      );
    } catch (error) {
      this.logger.error(
        `Failed to move the sold timeline entry for deal ${deal._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * The edit log row for an edit to a booked sale (PAC-104), in the shape
   * `PoliciesService.recordFieldChanges` writes for a policy (PAC-65 #9).
   *
   * Post-commit and best-effort, but logged at `error`: a dropped row is a hole
   * in an audit trail. `summary` carries no values — see the schema.
   */
  private async recordDealChanges(
    access: AccessContext,
    deal: DealDocument,
    before: ChangeSnapshot,
    after: DealChangeSubject,
    summary: string,
    policyId?: Types.ObjectId,
  ): Promise<void> {
    const changes = diffSnapshots(
      DEAL_CHANGE_FIELDS,
      before,
      snapshot(DEAL_CHANGE_FIELDS, after),
    );
    if (!changes.length) return;

    try {
      await this.activityModel.create({
        agencyId: deal.agencyId,
        branchId: deal.branchId,
        type: 'field_changed',
        subjectType: 'deal',
        ...(deal.leadId ? { leadId: deal.leadId } : {}),
        dealId: deal._id,
        ...(policyId ? { policyId } : {}),
        userId: new Types.ObjectId(access.userId),
        occurredAt: new Date(),
        summary,
        // Explicit: the schema default is 'migration'.
        source: 'internal',
        isTestRecord: false,
        changes,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record the edit log for deal ${deal._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Bring `Household.totalActivePolicies` back in line after an addition.
   *
   * Recounted rather than incremented, so a re-run is still right — the same
   * logic as `PolicyTransfersService.recountHouseholdPolicies`, agency-scoped.
   * Best-effort: the policies are booked either way.
   */
  private async recountActivePolicies(
    agencyId: string,
    householdId: Types.ObjectId,
  ): Promise<void> {
    try {
      const active = await this.policyModel.countDocuments({
        agencyId,
        householdId,
        active: true,
      });
      await this.householdModel.updateOne(
        { _id: householdId, agencyId },
        { $set: { totalActivePolicies: active } },
      );
    } catch (error) {
      this.logger.error(
        `Failed to recount active policies for household ${householdId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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

  /**
   * Household members the producer can name as defensive drivers.
   *
   * The roster comes from `householdMembers` (PAC-91 §5), which is also where
   * the role comes from — a person who is a Named Insured at home may be listed
   * here only as a Driver, and that is exactly the distinction this picker
   * exists to show.
   *
   * Deceased members are excluded (PAC-91 §7). This picker names who a **new**
   * policy's discount applies to, which is as forward-looking as it gets — a
   * defensive-driver certificate for somebody who has died is not a discount,
   * it is a compliance finding. They stay on the deals already sold; they are
   * simply not offered for the next one.
   */
  private async householdContacts(
    household: HouseholdDocument,
  ): Promise<SoldHouseholdContact[]> {
    const memberships = await this.memberships.listByHousehold(
      household.agencyId,
      household._id,
    );
    if (!memberships.length) return [];

    const roles = rolesByContact(memberships);
    const contacts = await this.contactModel
      .find({
        _id: { $in: memberships.map((membership) => membership.contactId) },
        agencyId: household.agencyId,
        // `null` also matches an absent field, so every living member qualifies
        // without a backfill (PAC-91 §7).
        deceasedAt: null,
      })
      .select('firstName lastName')
      .lean<
        Array<{
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
        }>
      >();

    return contacts.map((contact) => ({
      id: contact._id.toString(),
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      roleInHousehold: roles.get(contact._id.toString()) ?? undefined,
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
   *
   * Async since PAC-91 §4: the household no longer stores `primaryContactName`,
   * so the primary contact is read through `primaryContactId`. One query, on a
   * write path that already runs several — and the name is now right for a
   * migrated household, where the stored copy was always empty and the deal
   * therefore fell through to the household's own name.
   */
  private async clientName(
    lead: LeadDocument,
    household: HouseholdDocument,
  ): Promise<string | undefined> {
    const primary = household.primaryContactId
      ? await this.contactModel
          .findOne({
            _id: household.primaryContactId,
            agencyId: household.agencyId,
          })
          .select('firstName lastName')
          .lean<{ firstName?: string; lastName?: string } | null>()
      : null;

    return (
      contactDisplayName(primary)?.trim() ||
      household.name?.trim() ||
      this.leadName(lead)
    );
  }
}
