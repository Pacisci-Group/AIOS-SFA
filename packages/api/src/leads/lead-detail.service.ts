import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  LeadDetail,
  LeadDetailActivity,
  LeadDetailContact,
  LeadDetailDeal,
  LeadDetailHousehold,
  LeadDetailPolicy,
  LeadDetailPriorInsurance,
  LeadDetailPriorPolicy,
  LeadDetailQuoteRecap,
  LeadDetailQuoteRecapSummary,
  LEAD_SOURCE_NONE,
  UpdateLeadResult,
  normalizeLeadSource,
  normalizeLeadStatus,
  normalizePolicyType,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { resolveHouseholdAddress } from '../common/address/household-address';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import { HouseholdDocument } from '../households/schemas/household.schema';
import { Policy, PolicyDocument } from '../policies/schemas/policy.schema';
import {
  PriorInsurance,
  PriorInsuranceDocument,
} from '../prior-insurance/schemas/prior-insurance.schema';
import {
  PriorPolicy,
  PriorPolicyDocument,
} from '../prior-policies/schemas/prior-policy.schema';
import {
  QuoteRecap,
  QuoteRecapDocument,
} from '../quote-recaps/schemas/quote-recap.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadAccessService } from './lead-access.service';
import { Lead, LeadDocument } from './schemas/lead.schema';

/** Newest recaps considered. A lead with more than this has bigger problems. */
const RECAP_LIMIT = 10;

/** Newest activities returned. The timeline is a summary, not an audit log. */
const ACTIVITY_LIMIT = 50;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** ISO-8601 instant, or `null`. */
function iso(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * `YYYY-MM-DD` in UTC, or `null`.
 *
 * Dates of birth and policy dates are calendar dates, not instants. Returning
 * the full ISO timestamp is how a birthday becomes the previous day once a US
 * client renders it — the mirror of the `T00:00:00.000Z` parse that intake does
 * on the way in.
 */
function dateOnly(value?: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** First non-empty entry of a stored array field, or `null`. */
function first(values?: string[]): string | null {
  const found = values?.find((value) => Boolean(value?.trim()));
  return found ?? null;
}

function fullName(firstName?: string, lastName?: string): string {
  return [firstName, lastName]
    .filter((part) => Boolean(part?.trim()))
    .join(' ')
    .trim();
}

/**
 * The Lead Detail 360° read (PAC-38) — `GET /leads/:id`.
 *
 * Separate from {@link LeadsService}, which is entirely list/search/filter
 * machinery; the two share nothing but the collection.
 *
 * Output discipline is the same as `LeadRow` (see `leads.types.ts`): no
 * `legacy*` ids, no `isTestRecord`, no `agencyId`/`branchId`, no storage keys,
 * and no raw select codes — every status and policy type is normalized on the
 * way out.
 */
@Injectable()
export class LeadDetailService {
  private readonly logger = new Logger(LeadDetailService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecapDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(PriorInsurance.name)
    private readonly priorInsuranceModel: Model<PriorInsuranceDocument>,
    @InjectModel(PriorPolicy.name)
    private readonly priorPolicyModel: Model<PriorPolicyDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly leadAccess: LeadAccessService,
  ) {}

  /**
   * Assemble everything `/leads/:id` renders.
   *
   * Four sequential waves rather than one aggregation pipeline: each wave needs
   * an id the previous one produced (household → contacts, deal → prior
   * insurance), and every query inside a wave is index-backed and independent.
   *
   * Authorization is entirely {@link LeadAccessService.loadOwnedLead}, which
   * 404s — never 403s — for a lead outside the caller's scope. Everything after
   * it is filtered by `agencyId` plus an id that came from the lead itself, so
   * no downstream query can reach outside the tenant.
   */
  async get(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
  ): Promise<LeadDetail> {
    const lead = await this.leadAccess.loadOwnedLead(access, branchId, leadId);
    const household = await this.leadAccess.findHousehold(lead, access);

    // Every downstream query is scoped by the *lead's* own `agencyId`, not the
    // caller's. `AccessContext.agencyId` is nullable and `loadOwnedLead` has
    // already matched on it, so this is the same tenant — taking it from the
    // authorized record makes "nothing here can reach outside the tenant"
    // structurally true rather than a convention.
    const agencyId = lead.agencyId;

    const [contacts, policies, recaps, deal, activities] = await Promise.all([
      this.loadContacts(lead, household, agencyId),
      this.loadPolicies(household, agencyId),
      this.loadQuoteRecaps(lead, household, agencyId),
      this.loadDeal(lead, household, agencyId),
      this.loadActivities(lead, agencyId),
    ]);

    const [priorInsurance, producerNames] = await Promise.all([
      this.loadPriorInsurance(deal, household, agencyId),
      this.loadProducerNames(lead, activities),
    ]);

    const [latestRecap, ...earlierRecaps] = recaps;

    return {
      id: lead._id.toString(),
      name: fullName(lead.firstName, lead.lastName) || 'Unknown Lead',
      firstName: lead.firstName ?? '',
      lastName: lead.lastName ?? '',
      status: normalizeLeadStatus(lead.status),
      temperature: lead.temperature ?? 'Unknown',
      leadSource: this.toLeadSource(lead),
      emails: lead.emails ?? [],
      phones: lead.phones ?? [],
      address: resolveHouseholdAddress(
        lead.address,
        household?.propertyAddress,
        household?.mailingAddress,
      ),
      quoteControlNumber: lead.quoteControlNumber ?? null,
      agingDays: this.agingDays(lead),
      createdDate: iso(lead.createdDate),
      lastActivityAt: iso(lead.lastActivityAt),
      intakeChannel: lead.intakeSource?.channel ?? null,
      producerName: lead.producerId
        ? (producerNames.get(lead.producerId.toString()) ?? null)
        : null,
      primaryContact: this.findPrimaryContact(lead, household, contacts),
      household: this.toHousehold(household, lead, contacts, policies),
      latestQuoteRecap: latestRecap ? this.toQuoteRecap(latestRecap) : null,
      earlierQuoteRecaps: earlierRecaps.map((recap) =>
        this.toQuoteRecapSummary(recap),
      ),
      deal: deal ? this.toDeal(deal) : null,
      priorInsurance,
      activities: activities.map((activity) =>
        this.toActivity(activity, producerNames),
      ),
    };
  }

  /**
   * Apply the Lead Detail inline edits — `PATCH /leads/:id`.
   *
   * Same clamp as {@link get}: `loadOwnedLead` 404s for another producer's lead
   * before anything is written.
   *
   * Two deliberate behaviours worth knowing:
   *
   * 1. **`lastActivityAt` is always bumped.** The Leads list sorts on it, and an
   *    edit *is* activity — so the row moves to the top of `/leads` afterwards.
   *    Intended, not a bug.
   * 2. **Status is not forward-only**, unlike the automatic advance the Quote and
   *    Sold forms perform (`quote-recaps.service.ts`). Those move a lead along a
   *    pipeline it has demonstrably progressed through; this is a producer
   *    correcting a mistake, and Sold → Requote is a real operation. A one-way
   *    control would strand the record.
   *
   * No `Activity` row is written. None of the `ACTIVITY_TYPES` members means
   * "status changed", and adding one ripples through the migration, the demo
   * seed and the shared union — a follow-up, not a side effect of this ticket.
   */
  async update(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
    dto: UpdateLeadDto,
  ): Promise<UpdateLeadResult> {
    const lead = await this.leadAccess.loadOwnedLead(access, branchId, leadId);

    if (dto.status !== undefined) {
      lead.status = dto.status;
    }
    if (dto.temperature !== undefined) {
      lead.temperature = dto.temperature;
    }
    if (dto.leadSourceCode !== undefined) {
      lead.leadSource =
        dto.leadSourceCode === LEAD_SOURCE_NONE
          ? // The schema default, and the shape the `leadSource=__none__` list
            // filter matches — clearing has to land the lead back in that facet.
            { code: null, label: '' }
          : (() => {
              const source = normalizeLeadSource(dto.leadSourceCode);
              return { code: source.code, label: source.label };
            })();
    }

    lead.lastActivityAt = new Date();
    await lead.save();

    return {
      id: lead._id.toString(),
      status: normalizeLeadStatus(lead.status),
      temperature: lead.temperature ?? 'Unknown',
      leadSource: this.toLeadSource(lead),
      lastActivityAt: lead.lastActivityAt.toISOString(),
    };
  }

  /** Canonical source; migrated leads may hold only a label, share-link leads neither. */
  private toLeadSource(lead: LeadDocument) {
    const source = normalizeLeadSource(
      lead.leadSource?.code,
      lead.leadSource?.label,
    );
    return { code: source.code, label: source.label };
  }

  /**
   * Days since the lead was created, computed now.
   *
   * `lead.agingDays` is a migration-time snapshot and has been wrong by however
   * long ago the import ran ever since; it is deliberately not read here.
   */
  private agingDays(lead: LeadDocument): number {
    const created =
      lead.createdDate ?? (lead as unknown as { createdAt?: Date }).createdAt;
    if (!created) return 0;
    return Math.max(
      0,
      Math.floor((Date.now() - created.getTime()) / MS_PER_DAY),
    );
  }

  /**
   * The household roster.
   *
   * Prefers the household — that is the full roster, and a member added by a
   * later lead still belongs on it — and falls back to the lead's own contact
   * refs when the lead has no household.
   *
   * Deliberately **no** `.collation()`: the collated `{agencyId, lastName,
   * firstName}` index exists for intake's case-insensitive name matching. The
   * schema's warning about repeating the collation applies to that query, not
   * to an id lookup, and adding it here would only cost.
   */
  private async loadContacts(
    lead: LeadDocument,
    household: HouseholdDocument | null,
    agencyId: string,
  ): Promise<ContactDocument[]> {
    if (household) {
      return this.contactModel.find({ agencyId, householdId: household._id });
    }

    const ids = [
      lead.primaryContactId,
      ...(lead.memberContactIds ?? []),
    ].filter((id): id is Types.ObjectId => Boolean(id));
    if (!ids.length) return [];

    return this.contactModel.find({ agencyId, _id: { $in: ids } });
  }

  /** Household-level policies — `Policy` has no contact link, so this is as fine-grained as it gets. */
  private async loadPolicies(
    household: HouseholdDocument | null,
    agencyId: string,
  ): Promise<PolicyDocument[]> {
    if (!household) return [];
    return this.policyModel
      .find({ agencyId, householdId: household._id })
      .sort({ active: -1, expirationDate: -1 });
  }

  /**
   * The lead's quote recaps, newest first.
   *
   * ⚠ The legacy fallback is load-bearing, not defensive. The migration writes
   * only `legacyLeadId` on recaps and `backfill-deal-refs` repairs deals rather
   * than these — so a plain `{ leadId }` query returns nothing for *every*
   * migrated lead, and the quote block would be empty on all real data.
   *
   * When the fallback hits, the refs are backfilled fire-and-forget: each lead
   * repairs itself the first time it is viewed, exactly as
   * {@link LeadAccessService.findHousehold} does for households.
   *
   * Sorted `{ quoteDate: -1 }`, so a recap with no date sorts last — correct:
   * an undated recap is not "the latest".
   */
  private async loadQuoteRecaps(
    lead: LeadDocument,
    household: HouseholdDocument | null,
    agencyId: string,
  ): Promise<QuoteRecapDocument[]> {
    const byRef = await this.quoteRecapModel
      .find({ agencyId, leadId: lead._id })
      .sort({ quoteDate: -1, _id: -1 })
      .limit(RECAP_LIMIT);
    if (byRef.length) return byRef;

    if (!lead.legacySmartSuiteId) return [];

    const byLegacy = await this.quoteRecapModel
      .find({ agencyId, legacyLeadId: lead.legacySmartSuiteId })
      .sort({ quoteDate: -1, _id: -1 })
      .limit(RECAP_LIMIT);
    if (!byLegacy.length) return [];

    this.backfillLeadRef(
      this.quoteRecapModel,
      byLegacy.map((recap) => recap._id),
      lead,
      household,
      'quoteRecaps',
    );
    return byLegacy;
  }

  /** The sale this lead became, with the same legacy fallback as recaps. */
  private async loadDeal(
    lead: LeadDocument,
    household: HouseholdDocument | null,
    agencyId: string,
  ): Promise<DealDocument | null> {
    const byRef = await this.dealModel
      .findOne({ agencyId, leadId: lead._id })
      .sort({ soldDate: -1, _id: -1 });
    if (byRef) return byRef;

    if (!lead.legacySmartSuiteId) return null;

    const byLegacy = await this.dealModel
      .findOne({ agencyId, legacyLeadId: lead.legacySmartSuiteId })
      .sort({ soldDate: -1, _id: -1 });
    if (!byLegacy) return null;

    this.backfillLeadRef(
      this.dealModel,
      [byLegacy._id],
      lead,
      household,
      'deals',
    );
    return byLegacy;
  }

  /**
   * Self-healing backfill of `leadId` (+ `householdId`) on records the migration
   * linked only by legacy id.
   *
   * Fire-and-forget: this is a read path, and a failed repair must not fail the
   * page. The next view simply takes the fallback again.
   */
  private backfillLeadRef(
    model: Model<QuoteRecapDocument> | Model<DealDocument>,
    ids: Types.ObjectId[],
    lead: LeadDocument,
    household: HouseholdDocument | null,
    label: string,
  ): void {
    const update: Record<string, unknown> = { leadId: lead._id };
    if (household) update.householdId = household._id;

    void (model as Model<QuoteRecapDocument>)
      .updateMany({ _id: { $in: ids } }, { $set: update })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to backfill leadId on ${label} for lead ${lead._id.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * Prior coverage, reached through the deal and falling back to the household.
   *
   * Migration sets both `dealId` and `householdId` on these records, so unlike
   * recaps and deals no legacy-id fallback is needed. Returns `null` on an
   * unsold lead with no household record — the block is then hidden entirely
   * rather than rendered empty.
   */
  private async loadPriorInsurance(
    deal: DealDocument | null,
    household: HouseholdDocument | null,
    agencyId: string,
  ): Promise<LeadDetailPriorInsurance | null> {
    const scope = deal
      ? { dealId: deal._id }
      : household
        ? { householdId: household._id }
        : null;
    if (!scope) return null;

    const [record, policies] = await Promise.all([
      this.priorInsuranceModel.findOne({ agencyId, ...scope }),
      this.priorPolicyModel.find({ agencyId, ...scope }),
    ]);
    if (!record) return null;

    return {
      id: record._id.toString(),
      cancellationResponsibility: record.cancellationResponsibility ?? null,
      cancelledPreviousInsurance: record.cancelledPreviousInsurance ?? null,
      cancellationDate: dateOnly(record.cancellationDate),
      autoHomeSameCarrier: record.autoHomeSameCarrier ?? null,
      previousCarrierAuto: record.previousCarrierAuto ?? null,
      previousCarrierHome: record.previousCarrierHome ?? null,
      previousAgentName: record.previousAgentName ?? null,
      policies: policies.map((policy) => this.toPriorPolicy(policy)),
    };
  }

  private async loadActivities(
    lead: LeadDocument,
    agencyId: string,
  ): Promise<ActivityDocument[]> {
    return this.activityModel
      .find({ agencyId, leadId: lead._id })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(ACTIVITY_LIMIT);
  }

  /** One lookup for every producer referenced by the lead or its activities. */
  private async loadProducerNames(
    lead: LeadDocument,
    activities: ActivityDocument[],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    if (lead.producerId) ids.add(lead.producerId.toString());
    for (const activity of activities) {
      if (activity.producerId) ids.add(activity.producerId.toString());
    }
    if (!ids.size) return new Map();

    const users = await this.userModel
      .find({ _id: { $in: [...ids].map((id) => new Types.ObjectId(id)) } })
      .select('firstName lastName');

    return new Map(
      users.map((user) => [
        user._id.toString(),
        fullName(user.firstName, user.lastName),
      ]),
    );
  }

  /**
   * The lead's primary contact.
   *
   * `lead.primaryContactId` wins; the household's own primary is the fallback
   * for migrated leads that never carried the ref, and `isPrimary` the last
   * resort.
   */
  private findPrimaryContact(
    lead: LeadDocument,
    household: HouseholdDocument | null,
    contacts: ContactDocument[],
  ): LeadDetailContact | null {
    const preferred = [lead.primaryContactId, household?.primaryContactId]
      .filter((id): id is Types.ObjectId => Boolean(id))
      .map((id) => id.toString());

    for (const id of preferred) {
      const match = contacts.find((contact) => contact._id.toString() === id);
      if (match) return this.toContact(match, true);
    }

    const flagged = contacts.find((contact) => contact.isPrimary);
    return flagged ? this.toContact(flagged, true) : null;
  }

  private toContact(
    contact: ContactDocument,
    isPrimary: boolean,
  ): LeadDetailContact {
    return {
      id: contact._id.toString(),
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      name: fullName(contact.firstName, contact.lastName) || 'Unnamed contact',
      dateOfBirth: dateOnly(contact.dateOfBirth),
      email: first(contact.emails),
      phone: first(contact.phones),
      role: contact.roleInHousehold ?? null,
      isPrimary,
    };
  }

  /** `null` when the lead has no household — a real migrated gap, not an error. */
  private toHousehold(
    household: HouseholdDocument | null,
    lead: LeadDocument,
    contacts: ContactDocument[],
    policies: PolicyDocument[],
  ): LeadDetailHousehold | null {
    if (!household) return null;

    const primaryId = (
      lead.primaryContactId ?? household.primaryContactId
    )?.toString();

    // Primary first, then whatever order the roster came back in — the card
    // leads with the named insured.
    const members = [...contacts].sort((a, b) => {
      const aPrimary = a._id.toString() === primaryId || a.isPrimary;
      const bPrimary = b._id.toString() === primaryId || b.isPrimary;
      return Number(bPrimary) - Number(aPrimary);
    });

    return {
      id: household._id.toString(),
      name: household.name ?? null,
      address: resolveHouseholdAddress(
        lead.address,
        household.propertyAddress,
        household.mailingAddress,
      ),
      members: members.map((contact) =>
        this.toContact(contact, contact._id.toString() === primaryId),
      ),
      policies: policies.map((policy) => this.toPolicy(policy)),
      totalActivePolicies: household.totalActivePolicies ?? 0,
    };
  }

  private toPolicy(policy: PolicyDocument): LeadDetailPolicy {
    return {
      id: policy._id.toString(),
      policyType: normalizePolicyType(policy.policyType),
      carrier: policy.carrier ?? null,
      policyNumber: policy.policyNumber ?? null,
      active: policy.active ?? false,
      status: policy.policyStatus ?? null,
      premium: policy.premium ?? 0,
      items: policy.items ?? 0,
      effectiveDate: dateOnly(policy.effectiveDate),
      expirationDate: dateOnly(policy.expirationDate),
    };
  }

  private toQuoteRecapSummary(
    recap: QuoteRecapDocument,
  ): LeadDetailQuoteRecapSummary {
    return {
      id: recap._id.toString(),
      quoteDate: iso(recap.quoteDate),
      premium: recap.premium ?? 0,
      itemCount: recap.itemCount ?? 0,
      // Migrated recaps store raw SmartSuite codes here; the app writes labels.
      productsQuoted: (recap.productsQuoted ?? [])
        .map((value) => normalizePolicyType(value))
        .filter(Boolean),
      status: recap.recapStatus ?? null,
    };
  }

  private toQuoteRecap(recap: QuoteRecapDocument): LeadDetailQuoteRecap {
    return {
      ...this.toQuoteRecapSummary(recap),
      policies: (recap.policies ?? []).map((policy) => ({
        policyType: normalizePolicyType(policy.policyType),
        premium: policy.premium ?? 0,
        itemCount: policy.itemCount ?? 0,
      })),
      propertyAddress: recap.propertyAddress
        ? {
            street: recap.propertyAddress.street ?? '',
            city: recap.propertyAddress.city ?? '',
            state: recap.propertyAddress.state ?? '',
            zip: recap.propertyAddress.zip ?? '',
          }
        : null,
      notes: recap.notes ?? null,
      // Metadata only — the storage `key` stays server-side. Downloading the
      // document needs its own presigned-URL endpoint, not a client that knows
      // where the bytes live.
      document: recap.quoteDocument
        ? {
            filename: recap.quoteDocument.filename,
            contentType: recap.quoteDocument.contentType,
            size: recap.quoteDocument.size,
            uploadedAt: recap.quoteDocument.uploadedAt.toISOString(),
          }
        : null,
    };
  }

  private toDeal(deal: DealDocument): LeadDetailDeal {
    return {
      id: deal._id.toString(),
      soldDate: iso(deal.soldDate),
      premium: deal.premium ?? 0,
      itemCount: deal.itemCount ?? 0,
      policyCount: deal.policyCount ?? 0,
      dealType: deal.dealType ?? 'Other',
      isBundle: deal.isBundle ?? false,
      policyTypes: (deal.policyTypes ?? [])
        .map((value) => normalizePolicyType(value))
        .filter(Boolean),
    };
  }

  private toPriorPolicy(policy: PriorPolicyDocument): LeadDetailPriorPolicy {
    return {
      id: policy._id.toString(),
      policyType: policy.policyType
        ? normalizePolicyType(policy.policyType)
        : null,
      previousCarrier: policy.previousCarrier ?? null,
      cancellationStatus: policy.cancellationStatus ?? null,
      needsCancellation: policy.needsCancellation ?? null,
      cancellationDate: dateOnly(policy.cancellationDate),
      accordFormNeeded: policy.accordFormNeeded ?? null,
      completedDate: dateOnly(policy.completedDate),
    };
  }

  private toActivity(
    activity: ActivityDocument,
    producerNames: Map<string, string>,
  ): LeadDetailActivity {
    const producerName = activity.producerId
      ? (producerNames.get(activity.producerId.toString()) ?? null)
      : null;

    return {
      id: activity._id.toString(),
      type: activity.type,
      summary: activity.summary ?? null,
      occurredAt: iso(activity.occurredAt),
      producerName: producerName || null,
    };
  }
}
