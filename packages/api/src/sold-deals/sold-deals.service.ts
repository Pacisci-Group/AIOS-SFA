import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { normalizeLeadStatus } from '@sfa/shared';
import type {
  AccessContext,
  CreateSoldDealResponse,
  SoldDealLeadContext,
  SoldHouseholdContact,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { LeadAccessService } from '../leads/lead-access.service';
import type { HouseholdDocument } from '../households/schemas/household.schema';
import type { LeadDocument } from '../leads/schemas/lead.schema';
import type {
  CreateSoldDealDto,
  SoldDealContextDto,
} from './dto/create-sold-deal.dto';
import { SoldDealIntakeService } from './intake/sold-deal-intake.service';
import { buildSoldSubmissionToken } from './intake/sold.normalize';
import type { SoldIntakeContext } from './intake/sold-intake.types';

@Injectable()
export class SoldDealsService {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly leadAccess: LeadAccessService,
    private readonly intake: SoldDealIntakeService,
  ) {}

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
      // Populated by audit generation in PR5; zero until then rather than
      // absent, so the wire shape does not change under the web app later.
      auditItemCount: 0,
      crmAssigned: false,
    };
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
