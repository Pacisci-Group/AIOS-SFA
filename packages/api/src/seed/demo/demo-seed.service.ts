import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { FilterQuery, Model, Types } from 'mongoose';
import { ALL_MODULE_KEYS } from '@sfa/shared';
import { Agency } from '../../platform/schemas/agency.schema';
import { Branch } from '../../branches/schemas/branch.schema';
import { User } from '../../users/schemas/user.schema';
import { AgencyRole } from '../../roles/schemas/agency-role.schema';
import { Household } from '../../households/schemas/household.schema';
import { Contact } from '../../contacts/schemas/contact.schema';
import { Lead } from '../../leads/schemas/lead.schema';
import { QuoteRecap } from '../../quote-recaps/schemas/quote-recap.schema';
import { Deal } from '../../deals/schemas/deal.schema';
import { Policy } from '../../policies/schemas/policy.schema';
import { DealAuditItem } from '../../deal-audit-items/schemas/deal-audit-item.schema';
import { DealAudit } from '../../deal-audits/schemas/deal-audit.schema';
import { AuditTemplate } from '../../audit-templates/schemas/audit-template.schema';
import { InterestedParty } from '../../interested-parties/schemas/interested-party.schema';
import { PriorInsurance } from '../../prior-insurance/schemas/prior-insurance.schema';
import { PriorPolicy } from '../../prior-policies/schemas/prior-policy.schema';
import { ServiceTicket } from '../../service-tickets/schemas/service-ticket.schema';
import { ProducerAssignment } from '../../producer-assignments/schemas/producer-assignment.schema';
import { CrmRotation } from '../../crm-rotations/schemas/crm-rotation.schema';
import { TimeOffRequest } from '../../time-off-requests/schemas/time-off-request.schema';
import { ProducerGoal } from '../../producer-goals/schemas/producer-goal.schema';
import { Activity } from '../../activities/schemas/activity.schema';
import { PermissionsService } from '../../permissions/permissions.service';
import { deriveDealType, daysSince } from '../../migration/helpers/derive';
import { normalizeLeadSource } from '../../migration/helpers/lead-sources';
import {
  AUDIT_TEMPLATES,
  BRANCHES,
  BranchSlug,
  CARRIERS,
  CITIES,
  CitySpec,
  DEMO_CONFIG,
  FIRST_NAMES,
  LAST_NAMES,
  LEAD_SOURCE_CODES,
  LEAD_STATUSES,
  POLICY_TYPE_SETS,
  SERVICE_CATEGORIES,
  SERVICE_PRIORITIES,
  SERVICE_STATUSES,
  STREET_NAMES,
  STREET_SUFFIXES,
  TEAM,
  TeamMemberSpec,
} from './demo-data';
import { createRng, Rng } from './rng';

export interface DemoSeedOptions {
  agencySlug: string;
  agencyName: string;
  fresh: boolean;
  seed: number;
  password: string;
}

export type DemoSeedSummary = {
  agencyId: string;
  agencySlug: string;
  counts: Record<string, number>;
  logins: { email: string; role: string; password: string }[];
};

interface Ctx {
  agencyId: string;
  agencyObjectId: Types.ObjectId;
  branchIdBySlug: Record<BranchSlug, string>;
  branchObjectIdBySlug: Record<BranchSlug, Types.ObjectId>;
  defaultBranchId: string;
}

interface TeamMember {
  spec: TeamMemberSpec;
  userId: Types.ObjectId;
  branchSlug: BranchSlug;
  branchId: string;
  fullName: string;
}

interface HouseholdRef {
  id: Types.ObjectId;
  legacyId: string;
  name: string;
  clientFirst: string;
  clientLast: string;
  branchSlug: BranchSlug;
  branchId: string;
  assignedCrm?: TeamMember;
  city: CitySpec;
  address: Record<string, unknown>;
}

interface LeadRef {
  id: Types.ObjectId;
  legacyId: string;
  producer: TeamMember;
  occurredAt: Date;
  temperature: string;
}

interface QuoteRef {
  legacyId: string;
  producer: TeamMember;
  occurredAt: Date;
}

interface DealRef {
  id: Types.ObjectId;
  legacyId: string;
  producer: TeamMember;
  household: HouseholdRef;
  occurredAt: Date;
  clientName: string;
  policyTypes: string[];
  isBundle: boolean;
  premium: number;
}

interface PolicyRef {
  id: Types.ObjectId;
  legacyId: string;
  policyType: string;
  household: HouseholdRef;
  deal: DealRef;
}

/**
 * Builds a complete, self-consistent demo tenant (agency -> branches -> a full
 * role roster of users -> households/contacts -> leads/quotes/deals/policies ->
 * audits/hand-off items -> service tickets/ops -> goals/activities).
 *
 * Fully synthetic (no SmartSuite dependency), deterministic (fixed RNG seed),
 * and idempotent: every record is upserted on a stable `demo:*` key so re-runs
 * converge instead of duplicating. Pass `fresh: true` to purge demo data first.
 */
@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger('DemoSeed');
  private readonly now = new Date();
  private summary: Record<string, number> = {};

  constructor(
    @InjectModel(Agency.name) private readonly agencyModel: Model<Agency>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(AgencyRole.name)
    private readonly roleModel: Model<AgencyRole>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<Household>,
    @InjectModel(Contact.name) private readonly contactModel: Model<Contact>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecap>,
    @InjectModel(Deal.name) private readonly dealModel: Model<Deal>,
    @InjectModel(Policy.name) private readonly policyModel: Model<Policy>,
    @InjectModel(DealAuditItem.name)
    private readonly dealAuditItemModel: Model<DealAuditItem>,
    @InjectModel(DealAudit.name)
    private readonly dealAuditModel: Model<DealAudit>,
    @InjectModel(AuditTemplate.name)
    private readonly auditTemplateModel: Model<AuditTemplate>,
    @InjectModel(InterestedParty.name)
    private readonly interestedPartyModel: Model<InterestedParty>,
    @InjectModel(PriorInsurance.name)
    private readonly priorInsuranceModel: Model<PriorInsurance>,
    @InjectModel(PriorPolicy.name)
    private readonly priorPolicyModel: Model<PriorPolicy>,
    @InjectModel(ServiceTicket.name)
    private readonly serviceTicketModel: Model<ServiceTicket>,
    @InjectModel(ProducerAssignment.name)
    private readonly producerAssignmentModel: Model<ProducerAssignment>,
    @InjectModel(CrmRotation.name)
    private readonly crmRotationModel: Model<CrmRotation>,
    @InjectModel(TimeOffRequest.name)
    private readonly timeOffRequestModel: Model<TimeOffRequest>,
    @InjectModel(ProducerGoal.name)
    private readonly producerGoalModel: Model<ProducerGoal>,
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    private readonly permissionsService: PermissionsService,
  ) {}

  async run(options: DemoSeedOptions): Promise<DemoSeedSummary> {
    this.summary = {};
    const rng = createRng(options.seed);

    const { ctx } = await this.seedTenancy(options);
    if (options.fresh) {
      await this.purge(ctx.agencyId);
    }

    const team = await this.seedTeam(ctx, options.password);
    const producers = team.filter((m) => m.spec.roleSlug === 'producer');
    const crms = team.filter((m) => m.spec.roleSlug === 'crm');

    const households = await this.seedHouseholds(ctx, crms, rng);
    await this.seedContacts(ctx, households, rng);
    const leads = await this.seedLeads(ctx, producers, households, rng);
    const quotes = await this.seedQuotes(ctx, producers, households, rng);
    const deals = await this.seedDeals(ctx, producers, households, rng);
    const policies = await this.seedPolicies(ctx, deals, rng);

    await this.seedAuditTemplates(ctx);
    await this.seedDealAuditItems(ctx, deals, rng);
    await this.seedDealAudits(ctx, deals, rng);
    await this.seedInterestedParties(ctx, policies, rng);
    await this.seedPriorInsurance(ctx, deals, rng);
    await this.seedPriorPolicies(ctx, deals, rng);

    await this.seedServiceTickets(ctx, crms, households, policies, rng);
    await this.seedProducerAssignments(ctx, producers, crms, rng);
    await this.seedCrmRotations(ctx, producers, crms);
    await this.seedTimeOffRequests(ctx, producers, rng);

    await this.seedProducerGoals(ctx, producers);
    await this.seedActivities(ctx, leads, quotes, deals, rng);

    const logins = team.map((m) => ({
      email: m.spec.email,
      role: m.spec.roleSlug,
      password: options.password,
    }));

    return {
      agencyId: ctx.agencyId,
      agencySlug: options.agencySlug,
      counts: this.summary,
      logins,
    };
  }

  // ---------------------------------------------------------------------------
  // Tenancy: agency, branches, roles
  // ---------------------------------------------------------------------------

  private async seedTenancy(options: DemoSeedOptions): Promise<{ ctx: Ctx }> {
    const modules = Object.fromEntries(
      ALL_MODULE_KEYS.map((key) => [key, { enabled: true }]),
    );

    const agency = await this.agencyModel.findOneAndUpdate(
      { slug: options.agencySlug },
      {
        $set: { name: options.agencyName, status: 'active', modules },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const agencyObjectId = agency._id;
    this.inc('agencies');

    const branchIdBySlug = {} as Record<BranchSlug, string>;
    const branchObjectIdBySlug = {} as Record<BranchSlug, Types.ObjectId>;
    for (const b of BRANCHES) {
      const branch = await this.branchModel.findOneAndUpdate(
        { agencyId: agencyObjectId, slug: b.slug },
        { $set: { name: b.name, isDefault: b.isDefault } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      branchObjectIdBySlug[b.slug] = branch._id;
      branchIdBySlug[b.slug] = branch._id.toString();
      this.inc('branches');
    }

    await this.permissionsService.seedDefaultRoles(agencyObjectId);

    return {
      ctx: {
        agencyId: agencyObjectId.toString(),
        agencyObjectId,
        branchIdBySlug,
        branchObjectIdBySlug,
        defaultBranchId: branchIdBySlug.main,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Users: platform super admin + full role roster
  // ---------------------------------------------------------------------------

  private async seedTeam(ctx: Ctx, password: string): Promise<TeamMember[]> {
    const passwordHash = await bcrypt.hash(password, 10);

    // Platform super admin (no agency) — reconciled, not counted as team.
    const superAdminEmail =
      process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@sfa.local';
    await this.userModel.updateOne(
      { email: superAdminEmail },
      {
        $set: { isPlatformAdmin: true, isActive: true },
        $setOnInsert: {
          passwordHash,
          firstName: 'Super',
          lastName: 'Admin',
        },
      },
      { upsert: true },
    );
    this.inc('users');

    const roles = await this.roleModel.find({ agencyId: ctx.agencyObjectId });
    const roleIdBySlug = new Map(roles.map((r) => [r.slug, r._id]));

    const team: TeamMember[] = [];
    for (const spec of TEAM) {
      const roleId = roleIdBySlug.get(spec.roleSlug);
      const branchObjectId = ctx.branchObjectIdBySlug[spec.branch];
      const user = await this.userModel.findOneAndUpdate(
        { email: spec.email },
        {
          $set: {
            agencyId: ctx.agencyObjectId,
            branchId: branchObjectId,
            roleIds: roleId ? [roleId] : [],
            firstName: spec.firstName,
            lastName: spec.lastName,
            isActive: true,
            isPlatformAdmin: false,
            legacySmartSuiteId: `demo:user:${spec.key}`,
          },
          $setOnInsert: { passwordHash },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      this.inc('users');
      team.push({
        spec,
        userId: user._id,
        branchSlug: spec.branch,
        branchId: ctx.branchIdBySlug[spec.branch],
        fullName: `${spec.firstName} ${spec.lastName}`,
      });
    }
    return team;
  }

  // ---------------------------------------------------------------------------
  // Households + contacts
  // ---------------------------------------------------------------------------

  private async seedHouseholds(
    ctx: Ctx,
    crms: TeamMember[],
    rng: Rng,
  ): Promise<HouseholdRef[]> {
    const refs: HouseholdRef[] = [];
    for (let i = 0; i < DEMO_CONFIG.households; i++) {
      const clientFirst = rng.pick(FIRST_NAMES);
      const clientLast = rng.pick(LAST_NAMES);
      const branchSlug: BranchSlug = rng.chance(0.7) ? 'main' : 'north';
      const city = rng.pick(CITIES);
      const address = this.address(rng, city);
      const name = `${clientLast} Household`;
      const branchCrms = crms.filter((c) => c.branchSlug === branchSlug);
      const assignedCrm = branchCrms.length
        ? rng.pick(branchCrms)
        : crms.length
          ? rng.pick(crms)
          : undefined;
      const legacyId = `demo:hh:${i}`;

      const id = await this.upsert(
        this.householdModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: ctx.branchIdBySlug[branchSlug],
          legacySmartSuiteId: legacyId,
          name,
          status: rng.pick(['Active', 'Prospect', 'Active', 'Active']),
          propertyAddress: address,
          mailingAddress: address,
          primaryContactName: `${clientFirst} ${clientLast}`,
          primaryEmails: [this.email(clientFirst, clientLast)],
          primaryPhones: [this.phone(rng)],
          assignedCrmId: assignedCrm?.userId,
          totalActivePolicies: rng.int(0, 4),
          isTestRecord: false,
        },
      );
      this.inc('households');
      refs.push({
        id,
        legacyId,
        name,
        clientFirst,
        clientLast,
        branchSlug,
        branchId: ctx.branchIdBySlug[branchSlug],
        assignedCrm,
        city,
        address,
      });
    }
    return refs;
  }

  private async seedContacts(
    ctx: Ctx,
    households: HouseholdRef[],
    rng: Rng,
  ): Promise<void> {
    let i = 0;
    for (const hh of households) {
      // Primary contact (the named insured).
      await this.contact(ctx, rng, hh, i++, {
        firstName: hh.clientFirst,
        lastName: hh.clientLast,
        roleInHousehold: 'Primary',
        isPrimary: true,
      });
      // Spouse (~55%).
      if (rng.chance(0.55)) {
        await this.contact(ctx, rng, hh, i++, {
          firstName: rng.pick(FIRST_NAMES),
          lastName: hh.clientLast,
          roleInHousehold: 'Spouse',
          isPrimary: false,
        });
      }
      // Additional member (~35%).
      if (rng.chance(0.35)) {
        await this.contact(ctx, rng, hh, i++, {
          firstName: rng.pick(FIRST_NAMES),
          lastName: hh.clientLast,
          roleInHousehold: rng.pick([
            'Child',
            'Driver',
            'Additional Named Insured',
          ]),
          isPrimary: false,
        });
      }
    }
  }

  private async contact(
    ctx: Ctx,
    rng: Rng,
    hh: HouseholdRef,
    index: number,
    base: {
      firstName: string;
      lastName: string;
      roleInHousehold: string;
      isPrimary: boolean;
    },
  ): Promise<void> {
    const legacyId = `demo:contact:${index}`;
    await this.upsert(
      this.contactModel,
      { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
      {
        agencyId: ctx.agencyId,
        branchId: hh.branchId,
        legacySmartSuiteId: legacyId,
        firstName: base.firstName,
        lastName: base.lastName,
        emails: [this.email(base.firstName, base.lastName)],
        phones: [this.phone(rng)],
        dateOfBirth: this.birthDate(rng, base.roleInHousehold === 'Child'),
        roleInHousehold: base.roleInHousehold,
        isPrimary: base.isPrimary,
        householdId: hh.id,
        legacyHouseholdId: hh.legacyId,
        isTestRecord: false,
      },
    );
    this.inc('contacts');
  }

  // ---------------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------------

  private async seedLeads(
    ctx: Ctx,
    producers: TeamMember[],
    households: HouseholdRef[],
    rng: Rng,
  ): Promise<LeadRef[]> {
    const refs: LeadRef[] = [];
    for (let i = 0; i < DEMO_CONFIG.leads; i++) {
      const producer = this.weightedProducer(producers, rng);
      const hh = this.householdForBranch(households, producer.branchSlug, rng);
      const temperature = rng.pick([
        'Hot',
        'Hot',
        'Warm',
        'Warm',
        'Warm',
        'Cold',
        'Cold',
        'Unknown',
      ]);
      const status = rng.pick(LEAD_STATUSES);
      const createdDate = this.daysAgo(rng.int(0, 45));
      const lastActivityAt = this.daysAgo(rng.int(0, 6));
      const source = normalizeLeadSource(rng.pick(LEAD_SOURCE_CODES));
      const first = hh ? hh.clientFirst : rng.pick(FIRST_NAMES);
      const last = hh ? hh.clientLast : rng.pick(LAST_NAMES);
      const legacyId = `demo:lead:${i}`;

      const id = await this.upsert(
        this.leadModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: producer.branchId,
          legacySmartSuiteId: legacyId,
          firstName: first,
          lastName: last,
          emails: [this.email(first, last)],
          phones: [this.phone(rng)],
          status,
          temperature,
          leadSource: { code: source.code, label: source.label },
          agingDays: daysSince(createdDate),
          createdDate,
          lastActivityAt,
          quoteControlNumber: `QCN-${100000 + i}`,
          producerId: producer.userId,
          legacyHouseholdId: hh?.legacyId,
          isTestRecord: false,
        },
      );
      this.inc('leads');
      refs.push({
        id,
        legacyId,
        producer,
        occurredAt: createdDate,
        temperature,
      });
    }
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Quote recaps
  // ---------------------------------------------------------------------------

  private async seedQuotes(
    ctx: Ctx,
    producers: TeamMember[],
    households: HouseholdRef[],
    rng: Rng,
  ): Promise<QuoteRef[]> {
    const refs: QuoteRef[] = [];
    for (let i = 0; i < DEMO_CONFIG.quotes; i++) {
      const producer = this.weightedProducer(producers, rng);
      const hh = this.householdForBranch(households, producer.branchSlug, rng);
      const quoteDate = this.daysAgo(rng.int(0, 55));
      const products = rng.pick(POLICY_TYPE_SETS);
      const premium = rng.int(700, 5200);
      const legacyId = `demo:quote:${i}`;

      await this.upsert(
        this.quoteRecapModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: producer.branchId,
          legacySmartSuiteId: legacyId,
          title: hh ? `${hh.name} — Quote` : `Quote ${i + 1}`,
          quoteRecapAutoNumber: 1000 + i,
          quoteDate,
          premium,
          itemCount: products.length + rng.int(0, 2),
          productsQuoted: products,
          recapStatus: rng.pick(['Submitted', 'Draft', 'Submitted', 'Won']),
          producerId: producer.userId,
          legacyHouseholdId: hh?.legacyId,
          isTestRecord: false,
        },
      );
      this.inc('quoteRecaps');
      refs.push({ legacyId, producer, occurredAt: quoteDate });
    }
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Deals (Sold Log)
  // ---------------------------------------------------------------------------

  private async seedDeals(
    ctx: Ctx,
    producers: TeamMember[],
    households: HouseholdRef[],
    rng: Rng,
  ): Promise<DealRef[]> {
    const refs: DealRef[] = [];
    for (let i = 0; i < DEMO_CONFIG.deals; i++) {
      const producer = this.weightedProducer(producers, rng);
      const hh =
        this.householdForBranch(households, producer.branchSlug, rng) ??
        households[i % households.length];
      const policyTypes = rng.pick(POLICY_TYPE_SETS);
      const isBundle =
        policyTypes.some((t) => t.toLowerCase().includes('auto')) &&
        policyTypes.some((t) =>
          ['home', 'condo', 'renter'].some((k) => t.toLowerCase().includes(k)),
        );
      const dealType = deriveDealType(isBundle, policyTypes);
      const soldDate = this.daysAgo(rng.int(0, 55));
      const premium = rng.int(900, 4800);
      const clientName = `${hh.clientFirst} ${hh.clientLast}`;
      const source = normalizeLeadSource(rng.pick(LEAD_SOURCE_CODES));
      const legacyId = `demo:deal:${i}`;

      const id = await this.upsert(
        this.dealModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: producer.branchId,
          legacySmartSuiteId: legacyId,
          title: `${clientName} — ${dealType}`,
          dealAutoNumber: 5000 + i,
          soldDate,
          soldDateYmd: this.ymd(soldDate),
          premium,
          premiumSource: 'rollup',
          itemCount: policyTypes.length + rng.int(0, 3),
          policyCount: policyTypes.length,
          dealType,
          isBundle,
          policyTypes,
          leadSource: { code: source.code, label: source.label },
          clientName,
          producerId: producer.userId,
          legacyHouseholdId: hh.legacyId,
          dealAuditStatus: rng.pick(['Pending', 'In Progress', 'Complete']),
          status: 'Sold',
          isTestRecord: false,
        },
      );
      this.inc('deals');
      refs.push({
        id,
        legacyId,
        producer,
        household: hh,
        occurredAt: soldDate,
        clientName,
        policyTypes,
        isBundle,
        premium,
      });
    }
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Policies
  // ---------------------------------------------------------------------------

  private async seedPolicies(
    ctx: Ctx,
    deals: DealRef[],
    rng: Rng,
  ): Promise<PolicyRef[]> {
    const refs: PolicyRef[] = [];
    let n = 0;
    for (const deal of deals) {
      const share = deal.premium / Math.max(deal.policyTypes.length, 1);
      for (const policyType of deal.policyTypes) {
        const effectiveDate = deal.occurredAt;
        const expirationDate = new Date(effectiveDate);
        expirationDate.setMonth(expirationDate.getMonth() + 6);
        const renewalDate = expirationDate;
        const legacyId = `demo:policy:${n}`;

        const id = await this.upsert(
          this.policyModel,
          { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
          {
            agencyId: ctx.agencyId,
            branchId: deal.producer.branchId,
            legacySmartSuiteId: legacyId,
            policyNumber: `ALL-${policyType.slice(0, 2).toUpperCase()}-${200000 + n}`,
            policyType,
            carrier: 'Allstate',
            active: true,
            effectiveDate,
            expirationDate,
            renewalDate,
            premium: Math.round(share),
            items: 1 + rng.int(0, 2),
            policyStatus: 'Active',
            householdId: deal.household.id,
            legacyHouseholdId: deal.household.legacyId,
            dealId: deal.id,
            legacyDealId: deal.legacyId,
            isTestRecord: false,
          },
        );
        this.inc('policies');
        refs.push({
          id,
          legacyId,
          policyType,
          household: deal.household,
          deal,
        });
        n++;
      }
    }
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Audit templates + records + parent audits (Deals Pending Service Hand-off)
  // ---------------------------------------------------------------------------

  private async seedAuditTemplates(ctx: Ctx): Promise<void> {
    for (let i = 0; i < AUDIT_TEMPLATES.length; i++) {
      const t = AUDIT_TEMPLATES[i];
      const legacyId = `demo:tmpl:${i}`;
      await this.upsert(
        this.auditTemplateModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: ctx.defaultBranchId,
          legacySmartSuiteId: legacyId,
          name: t.name,
          category: t.category,
          required: t.required,
          blocking: t.blocking,
          active: true,
          alwaysInclude: t.alwaysInclude,
          task: t.task,
        },
      );
      this.inc('auditTemplates');
    }
  }

  private async seedDealAuditItems(
    ctx: Ctx,
    deals: DealRef[],
    rng: Rng,
  ): Promise<void> {
    // Newest deals drive the hand-off board — generate items for the most recent.
    const recent = [...deals]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 16);

    let n = 0;
    for (const deal of recent) {
      const applicable = this.applicableTemplates(deal, rng);
      // ~40% of recent deals still have open (failed, unresolved) items.
      const hasOpen = rng.chance(0.4);
      for (let k = 0; k < applicable.length; k++) {
        const template = applicable[k];
        const isFailed = hasOpen && k === 0; // first item is the open one
        const isResolved = !isFailed && rng.chance(0.85);
        const status = isFailed ? 'in_progress' : 'complete';
        const updateStatus = isResolved
          ? 'complete'
          : isFailed
            ? 'in_progress'
            : 'backlog';
        const legacyId = `demo:audit:${n}`;

        await this.upsert(
          this.dealAuditItemModel,
          { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
          {
            agencyId: ctx.agencyId,
            branchId: deal.producer.branchId,
            legacySmartSuiteId: legacyId,
            title: `${deal.clientName} — ${template.name}`,
            dealId: deal.id,
            legacyDealId: deal.legacyId,
            itemName: template.name,
            category: template.category,
            status,
            statusLabel: isFailed ? 'Failed' : 'Complete',
            updateStatus,
            updateStatusLabel: isResolved
              ? 'Complete'
              : isFailed
                ? 'In Progress'
                : 'Backlog',
            isFailed,
            isResolved,
            required: template.required,
            blocking: template.blocking,
            applicable: true,
            clientName: deal.clientName,
            producerName: deal.producer.fullName,
            producerId: deal.producer.userId,
            daysOpen: daysSince(deal.occurredAt),
            firstCreatedAt: deal.occurredAt,
            isTestRecord: false,
          },
        );
        this.inc('dealAuditItems');
        n++;
      }
    }
  }

  private async seedDealAudits(
    ctx: Ctx,
    deals: DealRef[],
    rng: Rng,
  ): Promise<void> {
    const recent = [...deals]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 16);
    let n = 0;
    for (const deal of recent) {
      const result = rng.pick(['Pass', 'Pass', 'Needs Review', 'Fail']);
      const legacyId = `demo:dealaudit:${n}`;
      await this.upsert(
        this.dealAuditModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: deal.producer.branchId,
          legacySmartSuiteId: legacyId,
          title: `${deal.clientName} — 24-Hour Audit`,
          auditId: `AUD-${9000 + n}`,
          auditDate: this.addDays(deal.occurredAt, 1),
          result,
          reasonCodes:
            result === 'Pass'
              ? []
              : rng.sample(
                  ['MISSING_DOC', 'PREMIUM_VAR', 'SIG_MISSING'],
                  rng.int(1, 2),
                ),
          auditScore: result === 'Pass' ? rng.int(90, 100) : rng.int(60, 89),
          auditNotes:
            result === 'Pass'
              ? 'All required documentation received.'
              : 'Follow-up required before full hand-off.',
          dealId: deal.id,
          legacyDealIds: [deal.legacyId],
          isTestRecord: false,
        },
      );
      this.inc('dealAudits');
      n++;
    }
  }

  private async seedInterestedParties(
    ctx: Ctx,
    policies: PolicyRef[],
    rng: Rng,
  ): Promise<void> {
    const homePolicies = policies.filter((p) =>
      ['home', 'condo', 'landlord', 'dwelling'].some((k) =>
        p.policyType.toLowerCase().includes(k),
      ),
    );
    let n = 0;
    for (const policy of homePolicies) {
      const legacyId = `demo:ip:${n}`;
      await this.upsert(
        this.interestedPartyModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: policy.deal.producer.branchId,
          legacySmartSuiteId: legacyId,
          title: `${policy.household.name} — Mortgagee`,
          status: rng.pick(['Verified', 'Pending']),
          priority: rng.pick(['Normal', 'High']),
          mortgagee: `${rng.pick(['First', 'Union', 'Summit', 'Heartland'])} ${rng.pick(['Bank', 'Mortgage', 'Financial'])}`,
          loanNumber: `LN-${700000 + n}`,
          address: policy.household.address,
          policyId: policy.id,
          legacyPolicyId: policy.legacyId,
          householdId: policy.household.id,
          legacyHouseholdId: policy.household.legacyId,
          isTestRecord: false,
        },
      );
      this.inc('interestedParties');
      n++;
    }
  }

  private async seedPriorInsurance(
    ctx: Ctx,
    deals: DealRef[],
    rng: Rng,
  ): Promise<void> {
    const withHome = deals.filter(
      (d) => d.policyTypes.length > 1 || d.isBundle,
    );
    let n = 0;
    for (const deal of withHome) {
      const legacyId = `demo:pi:${n}`;
      await this.upsert(
        this.priorInsuranceModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: deal.producer.branchId,
          legacySmartSuiteId: legacyId,
          title: `${deal.clientName} — Prior Insurance`,
          cancellationResponsibility: rng.pick(['Agent', 'Client']),
          cancelledPreviousInsurance: rng.pick(['Yes', 'No', 'Pending']),
          cancellationDate: this.addDays(deal.occurredAt, rng.int(1, 10)),
          autoHomeSameCarrier: rng.pick(['Yes', 'No']),
          previousCarrierAuto: rng.pick(CARRIERS),
          previousCarrierHome: rng.pick(CARRIERS),
          previousAgentName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
          dealId: deal.id,
          legacyDealId: deal.legacyId,
          householdId: deal.household.id,
          legacyHouseholdId: deal.household.legacyId,
          producerId: deal.producer.userId,
          isTestRecord: false,
        },
      );
      this.inc('priorInsurance');
      n++;
    }
  }

  private async seedPriorPolicies(
    ctx: Ctx,
    deals: DealRef[],
    rng: Rng,
  ): Promise<void> {
    const withHome = deals.filter(
      (d) => d.policyTypes.length > 1 || d.isBundle,
    );
    let n = 0;
    for (const deal of withHome) {
      const legacyId = `demo:pp:${n}`;
      const status = rng.pick(['Cancelled', 'Pending', 'Not Needed']);
      await this.upsert(
        this.priorPolicyModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: deal.producer.branchId,
          legacySmartSuiteId: legacyId,
          title: `${deal.clientName} — Prior Policy`,
          cancellationStatus: status,
          policyType: rng.pick(deal.policyTypes),
          needsCancellation: status === 'Cancelled' ? 'No' : 'Yes',
          cancellationDate:
            status === 'Cancelled'
              ? this.addDays(deal.occurredAt, rng.int(1, 14))
              : undefined,
          accordFormNeeded: rng.pick(['Yes', 'No']),
          previousCarrier: rng.pick(CARRIERS),
          completedDate:
            status === 'Cancelled'
              ? this.addDays(deal.occurredAt, rng.int(2, 16))
              : undefined,
          dealId: deal.id,
          legacyDealId: deal.legacyId,
          householdId: deal.household.id,
          legacyHouseholdId: deal.household.legacyId,
          isTestRecord: false,
        },
      );
      this.inc('priorPolicies');
      n++;
    }
  }

  // ---------------------------------------------------------------------------
  // Service tickets + ops (assignments, rotations, time off)
  // ---------------------------------------------------------------------------

  private async seedServiceTickets(
    ctx: Ctx,
    crms: TeamMember[],
    households: HouseholdRef[],
    policies: PolicyRef[],
    rng: Rng,
  ): Promise<void> {
    for (let i = 0; i < DEMO_CONFIG.serviceTickets; i++) {
      const hh = rng.pick(households);
      const branchCrms = crms.filter((c) => c.branchSlug === hh.branchSlug);
      const crm = (branchCrms.length ? branchCrms : crms).length
        ? rng.pick(branchCrms.length ? branchCrms : crms)
        : undefined;
      const policy = policies.find((p) => p.household.legacyId === hh.legacyId);
      const status = rng.pick(SERVICE_STATUSES);
      const createdDate = this.daysAgo(rng.int(0, 30));
      const resolved = status === 'Resolved';
      const legacyId = `demo:ticket:${i}`;

      await this.upsert(
        this.serviceTicketModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: hh.branchId,
          legacySmartSuiteId: legacyId,
          title: `${hh.name} — ${rng.pick(SERVICE_CATEGORIES)}`,
          createdDate,
          category: rng.pick(SERVICE_CATEGORIES),
          priority: rng.pick(SERVICE_PRIORITIES),
          dueDate: this.addDays(createdDate, rng.int(2, 14)),
          status,
          dateResolved: resolved
            ? this.addDays(createdDate, rng.int(1, 8))
            : undefined,
          daysOpen: daysSince(createdDate),
          clientName: `${hh.clientFirst} ${hh.clientLast}`,
          crmName: crm?.fullName,
          policyId: policy?.id,
          legacyPolicyId: policy?.legacyId,
          householdId: hh.id,
          legacyHouseholdId: hh.legacyId,
          assignedCrmId: crm?.userId,
          createdById: crm?.userId,
          isTestRecord: false,
        },
      );
      this.inc('serviceTickets');
    }
  }

  private async seedProducerAssignments(
    ctx: Ctx,
    producers: TeamMember[],
    crms: TeamMember[],
    rng: Rng,
  ): Promise<void> {
    let n = 0;
    for (const producer of producers) {
      const crm = crms.length ? rng.pick(crms) : undefined;
      const legacyId = `demo:pa:${n}`;
      await this.upsert(
        this.producerAssignmentModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: producer.branchId,
          legacySmartSuiteId: legacyId,
          title: `${producer.fullName} — CRM Assignment`,
          indexPointer: rng.int(0, crms.length),
          activeForProducer: true,
          lastAssignedAt: this.daysAgo(rng.int(0, 10)),
          lock: false,
          producerId: producer.userId,
          lastAssignedCrmId: crm?.userId,
        },
      );
      this.inc('producerAssignments');
      n++;
    }
  }

  private async seedCrmRotations(
    ctx: Ctx,
    producers: TeamMember[],
    crms: TeamMember[],
  ): Promise<void> {
    let n = 0;
    for (const producer of producers) {
      const branchCrms = crms.filter(
        (c) => c.branchSlug === producer.branchSlug,
      );
      const pool = branchCrms.length ? branchCrms : crms;
      for (let order = 0; order < pool.length; order++) {
        const legacyId = `demo:rot:${n}`;
        await this.upsert(
          this.crmRotationModel,
          { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
          {
            agencyId: ctx.agencyId,
            branchId: producer.branchId,
            legacySmartSuiteId: legacyId,
            title: `${producer.fullName} rotation #${order + 1}`,
            order,
            activeForProducer: order === 0,
            crmId: pool[order].userId,
            producerId: producer.userId,
          },
        );
        this.inc('crmRotations');
        n++;
      }
    }
  }

  private async seedTimeOffRequests(
    ctx: Ctx,
    producers: TeamMember[],
    rng: Rng,
  ): Promise<void> {
    for (let i = 0; i < DEMO_CONFIG.timeOffRequests; i++) {
      const producer = rng.pick(producers);
      const start = this.daysAgo(rng.int(-30, 20));
      const end = this.addDays(start, rng.int(0, 4));
      const status = rng.pick(['Approved', 'Pending', 'Approved', 'Denied']);
      const legacyId = `demo:too:${i}`;
      await this.upsert(
        this.timeOffRequestModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: producer.branchId,
          legacySmartSuiteId: legacyId,
          title: `${producer.fullName} — Time Off`,
          startDate: start,
          endDate: end,
          requestType: rng.pick(['PTO', 'Sick', 'Unpaid']),
          hoursRequested: (this.daysBetween(start, end) + 1) * 8,
          status,
          type: rng.pick(['Full Day', 'Partial Day']),
          decision: status === 'Pending' ? undefined : status,
          producerId: producer.userId,
        },
      );
      this.inc('timeOffRequests');
    }
  }

  // ---------------------------------------------------------------------------
  // Producer goals + activities
  // ---------------------------------------------------------------------------

  private async seedProducerGoals(
    ctx: Ctx,
    producers: TeamMember[],
  ): Promise<void> {
    const months = [this.monthKey(this.now), this.monthKey(this.addMonths(-1))];
    for (const producer of producers) {
      const goal = producer.spec.monthlyGoal ?? 50000;
      for (const month of months) {
        await this.producerGoalModel.updateOne(
          { agencyId: ctx.agencyId, producerId: producer.userId, month },
          {
            $set: {
              branchId: producer.branchId,
              goalPremium: goal,
              source: 'demo:seed',
            },
          },
          { upsert: true },
        );
        this.inc('producerGoals');
      }
    }
  }

  private async seedActivities(
    ctx: Ctx,
    leads: LeadRef[],
    quotes: QuoteRef[],
    deals: DealRef[],
    rng: Rng,
  ): Promise<void> {
    for (const lead of leads) {
      await this.activity(ctx, `demo:activity:lead:${lead.legacyId}`, {
        branchId: lead.producer.branchId,
        type: 'lead_created',
        subjectType: 'lead',
        leadId: lead.id,
        producerId: lead.producer.userId,
        occurredAt: lead.occurredAt,
        summary: 'Lead created',
      });
      // Hot leads get a couple of recent follow-up touches.
      if (lead.temperature === 'Hot') {
        const touches = rng.sample(
          ['call', 'text', 'email', 'note'],
          rng.int(1, 2),
        );
        for (let t = 0; t < touches.length; t++) {
          await this.activity(
            ctx,
            `demo:activity:touch:${lead.legacyId}:${t}`,
            {
              branchId: lead.producer.branchId,
              type: touches[t],
              subjectType: 'lead',
              leadId: lead.id,
              producerId: lead.producer.userId,
              occurredAt: this.daysAgo(rng.int(0, 5)),
              summary: this.touchSummary(touches[t]),
            },
          );
        }
      }
    }

    for (const quote of quotes) {
      await this.activity(ctx, `demo:activity:quoted:${quote.legacyId}`, {
        branchId: quote.producer.branchId,
        type: 'quoted',
        subjectType: 'quoteRecap',
        producerId: quote.producer.userId,
        occurredAt: quote.occurredAt,
        summary: 'Quote recap created',
      });
    }

    for (const deal of deals) {
      await this.activity(ctx, `demo:activity:sold:${deal.legacyId}`, {
        branchId: deal.producer.branchId,
        type: 'sold',
        subjectType: 'deal',
        dealId: deal.id,
        producerId: deal.producer.userId,
        occurredAt: deal.occurredAt,
        summary: `Deal sold: ${deal.clientName}`,
      });
    }
  }

  private async activity(
    ctx: Ctx,
    key: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    await this.upsert(
      this.activityModel,
      { agencyId: ctx.agencyId, legacySmartSuiteId: key },
      {
        agencyId: ctx.agencyId,
        legacySmartSuiteId: key,
        source: 'demo',
        isTestRecord: false,
        ...fields,
      },
    );
    this.inc('activities');
  }

  // ---------------------------------------------------------------------------
  // Purge (for --fresh)
  // ---------------------------------------------------------------------------

  private async purge(agencyId: string): Promise<void> {
    const demoFilter = {
      agencyId,
      legacySmartSuiteId: { $regex: '^demo:' },
    };
    const models: Model<unknown>[] = [
      this.householdModel,
      this.contactModel,
      this.leadModel,
      this.quoteRecapModel,
      this.dealModel,
      this.policyModel,
      this.dealAuditItemModel,
      this.dealAuditModel,
      this.auditTemplateModel,
      this.interestedPartyModel,
      this.priorInsuranceModel,
      this.priorPolicyModel,
      this.serviceTicketModel,
      this.producerAssignmentModel,
      this.crmRotationModel,
      this.timeOffRequestModel,
      this.activityModel,
    ] as Model<unknown>[];
    for (const model of models) {
      await model.deleteMany(demoFilter as FilterQuery<unknown>);
    }
    await this.producerGoalModel.deleteMany({ agencyId, source: 'demo:seed' });
    this.logger.log('Purged existing demo records');
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  private async upsert<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    doc: Record<string, unknown>,
  ): Promise<Types.ObjectId> {
    const res = await model
      .findOneAndUpdate(
        filter,
        { $set: doc },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          projection: { _id: 1 },
        },
      )
      .lean();
    return (res as unknown as { _id: Types.ObjectId })._id;
  }

  private inc(key: string, by = 1): void {
    this.summary[key] = (this.summary[key] ?? 0) + by;
  }

  /** Producers are weighted so the demo "hero" (Pat Producer) has the richest data. */
  private weightedProducer(producers: TeamMember[], rng: Rng): TeamMember {
    const hero = producers.find((p) => p.spec.key === 'producer');
    if (hero && rng.chance(0.35)) return hero;
    return rng.pick(producers);
  }

  private householdForBranch(
    households: HouseholdRef[],
    branch: BranchSlug,
    rng: Rng,
  ): HouseholdRef | undefined {
    const inBranch = households.filter((h) => h.branchSlug === branch);
    const pool = inBranch.length ? inBranch : households;
    return pool.length ? rng.pick(pool) : undefined;
  }

  private applicableTemplates(deal: DealRef, rng: Rng) {
    const isHome = deal.policyTypes.some((t) =>
      ['home', 'condo', 'landlord', 'dwelling', 'renter'].some((k) =>
        t.toLowerCase().includes(k),
      ),
    );
    const isAuto = deal.policyTypes.some((t) =>
      t.toLowerCase().includes('auto'),
    );
    return AUDIT_TEMPLATES.filter((t) => {
      if (t.alwaysInclude) return true;
      if (t.category === 'Property') return isHome && rng.chance(0.6);
      if (t.category === 'Auto') return isAuto && rng.chance(0.5);
      if (t.category === 'Prior Insurance') return deal.isBundle || isHome;
      return rng.chance(0.5);
    });
  }

  private address(rng: Rng, city: CitySpec): Record<string, unknown> {
    return {
      line1: `${rng.int(100, 9999)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_SUFFIXES)}`,
      city: city.city,
      state: city.state,
      zip: city.zip,
    };
  }

  private email(first: string, last: string): string {
    return `${first}.${last}@example.com`.toLowerCase();
  }

  private phone(rng: Rng): string {
    return `(312) 555-${String(rng.int(1000, 9999))}`;
  }

  private birthDate(rng: Rng, child: boolean): Date {
    const age = child ? rng.int(1, 17) : rng.int(25, 70);
    return new Date(
      this.now.getFullYear() - age,
      rng.int(0, 11),
      rng.int(1, 28),
    );
  }

  private touchSummary(type: string): string {
    switch (type) {
      case 'call':
        return 'Outbound call — left voicemail';
      case 'text':
        return 'Sent follow-up text';
      case 'email':
        return 'Emailed quote details';
      default:
        return 'Logged a note';
    }
  }

  private daysAgo(n: number): Date {
    return new Date(this.now.getTime() - n * 86400000);
  }

  private addDays(date: Date, n: number): Date {
    return new Date(date.getTime() + n * 86400000);
  }

  private daysBetween(a: Date, b: Date): number {
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
  }

  private addMonths(n: number): Date {
    return new Date(this.now.getFullYear(), this.now.getMonth() + n, 1);
  }

  private ymd(date: Date): number {
    return (
      date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
    );
  }

  private monthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}
