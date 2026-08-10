import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  ContactSummary,
  DataScope,
  HouseholdSummary,
  HouseholdView,
  PolicySearchResult,
  PolicySummary,
  PolicyView,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import {
  normalizeName,
  parseDateOfBirth,
} from '../leads/intake/intake.normalize';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import { AddHouseholdMemberDto } from './dto/add-household-member.dto';

/**
 * Access to client records (households, their members, and their
 * policies).
 *
 * These records are shared across a branch — unlike service tickets they carry
 * no per-user owner — so the `own` data scope has nothing to filter on and
 * deliberately collapses to branch. Anything out of scope is reported as 404
 * rather than 403 so record existence does not leak across tenants.
 */
/**
 * The slice of a `Policy` renewal outreach needs. Dates stay as `Date` (not ISO
 * strings) because the scheduler does arithmetic on them; `branchId` comes
 * through as the plain string this collection stores.
 */
export interface PolicyRenewalCandidate {
  id: string;
  policyNumber: string;
  policyType: string;
  carrier: string;
  premium: number;
  renewalDate: Date | null;
  expirationDate: Date | null;
  householdId: string | null;
  dealId: string | null;
  branchId: string | null;
}

@Injectable()
export class ClientsService {
  constructor(
    @InjectModel(Household.name)
    private householdModel: Model<HouseholdDocument>,
    @InjectModel(Policy.name) private policyModel: Model<PolicyDocument>,
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
  ) {}

  /**
   * Tenant + data-scope filter. NOTE: `TenantRecord.agencyId` / `branchId` are
   * plain strings on these collections (unlike `ServiceTicket`, where they are
   * ObjectIds) — do not cast them.
   */
  private scopeFilter(access: AccessContext): FilterQuery<{
    agencyId: string;
    branchId: string;
  }> {
    if (!access.agencyId) {
      // Defensive; the guards prevent this.
      throw new ForbiddenException('Agency context required');
    }

    const filter: FilterQuery<{ agencyId: string; branchId: string }> = {
      agencyId: access.agencyId,
    };

    if (access.dataScope === DataScope.Agency) {
      return filter;
    }

    // `branch` and `own` both resolve to branch: client records are shared and
    // have no assigned user for `own` to key on.
    if (access.branchId) {
      filter.branchId = access.branchId;
    }
    return filter;
  }

  /**
   * Typeahead over households in scope. An empty term returns the first page
   * so the picker has something to show before the user types.
   */
  async searchHouseholds(
    access: AccessContext,
    term: string,
    limit = 20,
  ): Promise<HouseholdSummary[]> {
    const filter: FilterQuery<HouseholdDocument> = this.scopeFilter(access);
    const q = term.trim();
    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      filter.$or = [{ name: rx }, { primaryContactName: rx }];
    }

    const households = await this.householdModel
      .find(filter)
      .sort({ name: 1 })
      .limit(clampLimit(limit))
      .lean();
    return households.map(toHouseholdSummary);
  }

  /**
   * Typeahead over policies in scope, by policy number, type, or carrier.
   *
   * `householdId` narrows the search to a single household — the New Ticket
   * dialog opened from a household page passes it so the picker cannot offer
   * another client's policy. An id that is malformed or out of scope yields an
   * empty list rather than the unfiltered book: a picker that silently widens
   * on a bad id is the failure this filter exists to prevent.
   */
  async searchPolicies(
    access: AccessContext,
    term: string,
    limit = 20,
    householdId?: string,
  ): Promise<PolicySearchResult[]> {
    const scope = this.scopeFilter(access);
    const filter: FilterQuery<PolicyDocument> = { ...scope };
    const q = term.trim();
    if (q) {
      const rx = new RegExp(escapeRegExp(q), 'i');
      filter.$or = [{ policyNumber: rx }, { policyType: rx }, { carrier: rx }];
    }
    if (householdId !== undefined) {
      if (!Types.ObjectId.isValid(householdId)) {
        return [];
      }
      filter.householdId = new Types.ObjectId(householdId);
    }

    const policies = await this.policyModel
      .find(filter)
      .sort({ active: -1, policyNumber: 1 })
      .limit(clampLimit(limit))
      .lean();

    // Resolve the owning households in one round-trip for the picker labels.
    const householdIds = policies
      .map((p) => p.householdId)
      .filter((id): id is Types.ObjectId => Boolean(id));
    const households = householdIds.length
      ? await this.householdModel
          .find({ ...scope, _id: { $in: householdIds } })
          .select('name')
          .lean()
      : [];
    const nameById = new Map(
      households.map((h) => [String(h._id), h.name ?? null]),
    );

    return policies.map((policy) => ({
      ...toPolicySummary(policy),
      householdId: policy.householdId ? String(policy.householdId) : null,
      householdName: policy.householdId
        ? (nameById.get(String(policy.householdId)) ?? null)
        : null,
    }));
  }

  /**
   * Active policies whose renewal falls inside a window, for proactive renewal
   * outreach.
   *
   * A *method*, not an endpoint: the renewal horizon is an internal concern of
   * the CRM module, and exposing it as a route would duplicate that logic in
   * two places with no owner. More importantly it keeps the tenancy cast in
   * this file — `Policy.agencyId` is a plain **string** here, and a wrong cast
   * returns zero documents with no error, which surfaces as an empty desk that
   * nobody notices for weeks.
   *
   * Backed by `{agencyId, active, renewalDate}` on `policies`; `limit` bounds
   * one pass so a large book converges over several requests rather than
   * blocking one.
   */
  async findRenewalWindow(
    access: AccessContext,
    from: Date,
    to: Date,
    limit = 500,
  ): Promise<PolicyRenewalCandidate[]> {
    const scope = this.scopeFilter(access);
    const policies = await this.policyModel
      .find({
        ...scope,
        active: true,
        renewalDate: { $ne: null, $gte: from, $lte: to },
      })
      .sort({ renewalDate: 1 })
      .limit(limit)
      .lean();

    return policies.map((policy) => ({
      id: String(policy._id),
      policyNumber: policy.policyNumber ?? '',
      policyType: policy.policyType ?? '',
      carrier: policy.carrier ?? '',
      premium: policy.premium ?? 0,
      renewalDate: policy.renewalDate ?? null,
      expirationDate: policy.expirationDate ?? null,
      householdId: policy.householdId ? String(policy.householdId) : null,
      dealId: policy.dealId ? String(policy.dealId) : null,
      branchId: policy.branchId ?? null,
    }));
  }

  /**
   * The same shape by id, for reconciling a cycle whose policies may have been
   * deactivated or deleted since it was created. Out-of-scope and missing ids
   * are simply absent from the result.
   */
  async findRenewalCandidatesByIds(
    access: AccessContext,
    ids: string[],
  ): Promise<PolicyRenewalCandidate[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!objectIds.length) {
      return [];
    }

    const policies = await this.policyModel
      .find({ ...this.scopeFilter(access), _id: { $in: objectIds } })
      .lean();

    return policies
      .filter((policy) => policy.active)
      .map((policy) => ({
        id: String(policy._id),
        policyNumber: policy.policyNumber ?? '',
        policyType: policy.policyType ?? '',
        carrier: policy.carrier ?? '',
        premium: policy.premium ?? 0,
        renewalDate: policy.renewalDate ?? null,
        expirationDate: policy.expirationDate ?? null,
        householdId: policy.householdId ? String(policy.householdId) : null,
        dealId: policy.dealId ? String(policy.dealId) : null,
        branchId: policy.branchId ?? null,
      }));
  }

  async getHousehold(
    access: AccessContext,
    id: string,
  ): Promise<HouseholdView> {
    const scope = this.scopeFilter(access);
    // Guard the cast so a malformed id 404s instead of throwing a CastError.
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Household not found');
    }

    const household = await this.householdModel
      .findOne({ ...scope, _id: new Types.ObjectId(id) })
      .lean();
    if (!household) {
      throw new NotFoundException('Household not found');
    }

    const householdId = new Types.ObjectId(id);
    const [contacts, policies] = await Promise.all([
      this.contactModel
        .find({ ...scope, householdId })
        .sort({ isPrimary: -1, lastName: 1 })
        .lean(),
      this.policyModel
        .find({ ...scope, householdId })
        .sort({ active: -1, renewalDate: 1 })
        .lean(),
    ]);

    return {
      ...toHouseholdSummary(household),
      propertyAddress: household.propertyAddress ?? null,
      mailingAddress: household.mailingAddress ?? null,
      primaryEmails: household.primaryEmails ?? [],
      primaryPhones: household.primaryPhones ?? [],
      assignedCrmId: household.assignedCrmId
        ? String(household.assignedCrmId)
        : null,
      contacts: contacts.map(toContactSummary),
      policies: policies.map(toPolicySummary),
    };
  }

  /**
   * Add a member to a household — the "+ Member" dialog on the Household page.
   *
   * A member **is** a `Contact`; there is no separate member record. The write
   * is therefore two documents: the contact, and the household's
   * `memberContactIds`. Both are needed — the contact's `householdId` is what
   * the household page reads, while `memberContactIds` is what the lead-intake
   * pipeline and the migration maintain, and letting them disagree is how a
   * member becomes visible on one screen and not another.
   *
   * Tenancy comes from the household, never from the caller: a producer whose
   * branch differs from the household's would otherwise stamp a contact into a
   * branch the household does not belong to, and that contact would then be
   * invisible to everyone reading the household.
   *
   * Deliberately **not** deduplicated against existing contacts, unlike
   * `ResolveContactStep`. That matcher exists because a public form is filled
   * by strangers who may already be in the book; this dialog is a human on the
   * household's own page, who can see the current members listed beside the
   * button. Silently merging their new "Child · Sam" into an existing Sam
   * would be the surprising outcome here.
   */
  async addHouseholdMember(
    access: AccessContext,
    householdId: string,
    dto: AddHouseholdMemberDto,
  ): Promise<ContactSummary> {
    const scope = this.scopeFilter(access);
    if (!Types.ObjectId.isValid(householdId)) {
      throw new NotFoundException('Household not found');
    }

    const household = await this.householdModel.findOne({
      ...scope,
      _id: new Types.ObjectId(householdId),
    });
    if (!household) {
      throw new NotFoundException('Household not found');
    }

    const contact = await this.contactModel.create({
      agencyId: household.agencyId,
      branchId: household.branchId,
      firstName: normalizeName(dto.firstName),
      lastName: normalizeName(dto.lastName),
      // Parsed to UTC midnight from explicit components — never
      // `new Date(str)`, which shifts a birthday a day west of Greenwich.
      dateOfBirth: dto.dateOfBirth
        ? (parseDateOfBirth(dto.dateOfBirth) ?? undefined)
        : undefined,
      roleInHousehold: dto.role,
      // Never primary: that role belongs to the household's Named Insured, and
      // the dialog does not offer it (see `add-household-member.dto.ts`).
      isPrimary: false,
      householdId: household._id,
      emails: [],
      phones: [],
      isTestRecord: false,
    });

    await this.householdModel.updateOne(
      { _id: household._id },
      { $addToSet: { memberContactIds: contact._id } },
    );

    return toContactSummary(contact.toObject());
  }

  async getPolicy(access: AccessContext, id: string): Promise<PolicyView> {
    const scope = this.scopeFilter(access);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Policy not found');
    }

    const policy = await this.policyModel
      .findOne({ ...scope, _id: new Types.ObjectId(id) })
      .lean();
    if (!policy) {
      throw new NotFoundException('Policy not found');
    }

    // Re-apply the scope filter to the parent so a household outside the
    // caller's branch simply reads as absent.
    const household = policy.householdId
      ? await this.householdModel
          .findOne({ ...scope, _id: policy.householdId })
          .lean()
      : null;

    return {
      ...toPolicySummary(policy),
      notes: policy.notes ?? null,
      household: household ? toHouseholdSummary(household) : null,
    };
  }
}

function toHouseholdSummary(
  household: Household & { _id: unknown },
): HouseholdSummary {
  return {
    id: String(household._id),
    name: household.name ?? null,
    status: household.status ?? null,
    primaryContactName: household.primaryContactName ?? null,
    totalActivePolicies: household.totalActivePolicies ?? 0,
  };
}

function toPolicySummary(policy: Policy & { _id: unknown }): PolicySummary {
  return {
    id: String(policy._id),
    policyNumber: policy.policyNumber ?? null,
    policyType: policy.policyType ?? null,
    carrier: policy.carrier ?? null,
    active: policy.active ?? false,
    policyStatus: policy.policyStatus ?? null,
    premium: policy.premium ?? 0,
    items: policy.items ?? 0,
    effectiveDate: toIso(policy.effectiveDate),
    expirationDate: toIso(policy.expirationDate),
    renewalDate: toIso(policy.renewalDate),
  };
}

function toContactSummary(contact: Contact & { _id: unknown }): ContactSummary {
  return {
    id: String(contact._id),
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    emails: contact.emails ?? [],
    phones: contact.phones ?? [],
    roleInHousehold: contact.roleInHousehold ?? null,
    isPrimary: contact.isPrimary ?? false,
    dateOfBirth: toIso(contact.dateOfBirth),
  };
}

function toIso(value: Date | undefined | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** Search terms are user input — never let them compile as a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);
}
