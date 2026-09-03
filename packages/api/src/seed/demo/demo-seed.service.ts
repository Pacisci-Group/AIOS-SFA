import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  ALL_MODULE_KEYS,
  DEAL_AUDIT_REASON_CODES,
  DEFAULT_DEAL_AUDIT_STATUS,
} from '@sfa/shared';
import type { DealAuditStatus } from '@sfa/shared';
import { reconcileDealAudits } from '../../deal-audits/audit-reconcile';
import { SequenceService } from '../../common/mongo/sequence.service';
import {
  householdCounterKey,
  reconcileHouseholdRefs,
} from '../../households/household-ref';
import { Agency } from '../../platform/schemas/agency.schema';
import { Branch } from '../../branches/schemas/branch.schema';
import { User } from '../../users/schemas/user.schema';
import { AgencyRole } from '../../roles/schemas/agency-role.schema';
import { Household } from '../../households/schemas/household.schema';
import { Contact } from '../../contacts/schemas/contact.schema';
import { Lead } from '../../leads/schemas/lead.schema';
import { quoteDateYmd } from '../../quote-recaps/quote.normalize';
import { QuoteRecap } from '../../quote-recaps/schemas/quote-recap.schema';
import { Deal } from '../../deals/schemas/deal.schema';
import { Policy } from '../../policies/schemas/policy.schema';
import { DealAuditItem } from '../../deal-audit-items/schemas/deal-audit-item.schema';
import { DealAudit } from '../../deal-audits/schemas/deal-audit.schema';
import { AuditTemplate } from '../../audit-templates/schemas/audit-template.schema';
import { InterestedParty } from '../../interested-parties/schemas/interested-party.schema';
import { PriorInsurance } from '../../prior-insurance/schemas/prior-insurance.schema';
import { PriorPolicy } from '../../prior-policies/schemas/prior-policy.schema';
import { ServiceTicket } from '../../crm/schemas/service-ticket.schema';
import { ProducerAssignment } from '../../producer-assignments/schemas/producer-assignment.schema';
import { CrmRotation } from '../../crm-rotations/schemas/crm-rotation.schema';
import { TimeOffRequest } from '../../time-off-requests/schemas/time-off-request.schema';
import { ProducerGoal } from '../../producer-goals/schemas/producer-goal.schema';
import { Activity } from '../../activities/schemas/activity.schema';
import { RoleAssignmentsService } from '../../permissions/role-assignments.service';
import { Permission } from '../../permissions/schemas/permission.schema';
import { Carrier } from '../../carriers/schemas/carrier.schema';
import { seedPermissions } from '../permissions.seed';
import { seedCarriers } from '../carriers.seed';
import { deriveDealType, daysSince } from '../../migration/helpers/derive';
import {
  INSURANCE_MONTHS,
  normalizeLeadSource,
  POLICY_TYPES,
  resolveItemCount,
} from '@sfa/shared';
import { AUDIT_ITEM_DUE_DAYS } from '../../audit-generation/audit-generation.service';
import { seedAuditTemplates } from '../audit-templates.seed';
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
  MAILER_CITIES,
  DEMO_LEAD_UNQUOTED_STATUSES,
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
import { Mailer } from '../../mailers/schemas/mailer.schema';
import { mailerControlNumberKeys } from '../../common/mailers/mailer-control-number';

export interface DemoSeedOptions {
  agencySlug: string;
  agencyName: string;
  /**
   * The domain of every team member's email, e.g. `demoagency.local`.
   *
   * `User.email` is globally unique and the roster is upserted by email, so
   * two agencies seeded with the same domain would *move* one roster into the
   * other tenant rather than add a second. Each agency gets its own domain
   * (derived from the slug unless `--email-domain` says otherwise), which is
   * what makes `--agency texas-holdings` add a second populated tenant for
   * cross-agency features like the Super Admin user directory (PAC-70).
   */
  emailDomain: string;
  fresh: boolean;
  seed: number;
  password: string;
}

export type DemoSeedSummary = {
  agencyId: string;
  agencySlug: string;
  counts: Record<string, number>;
  logins: { email: string; role: string; password: string }[];
  /**
   * A few seeded Quote Control Numbers, both forms.
   *
   * Printed by the seed because a mailer is only reachable *by* its control
   * number — there is no list view — so without this the demo mailers exist but
   * nobody can look one up.
   */
  sampleMailerControlNumbers: { long: string; short: string }[];
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
  /** `spec.email` re-domained for this agency — the address actually stored. */
  email: string;
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

interface ContactRef {
  id: Types.ObjectId;
  legacyId: string;
  isPrimary: boolean;
}

interface LeadRef {
  id: Types.ObjectId;
  legacyId: string;
  producer: TeamMember;
  /** Undefined only if no households were seeded at all. */
  household?: HouseholdRef;
  occurredAt: Date;
  temperature: string;
  /** Drives the pipeline: `Sold` leads get a deal, `Quoted`/`Requote` a recap. */
  status: string;
}

interface QuoteRef {
  id: Types.ObjectId;
  legacyId: string;
  producer: TeamMember;
  /** The lead this recap belongs to — mirrors what the migration now writes. */
  lead: LeadRef;
  occurredAt: Date;
}

interface DealRef {
  id: Types.ObjectId;
  legacyId: string;
  producer: TeamMember;
  household: HouseholdRef;
  /** The lead this sale closed. */
  lead: LeadRef;
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
    @InjectModel(Mailer.name) private readonly mailerModel: Model<Mailer>,
    @InjectModel(Permission.name)
    private readonly permissionModel: Model<Permission>,
    @InjectModel(Carrier.name) private readonly carrierModel: Model<Carrier>,
    private readonly roleAssignments: RoleAssignmentsService,
    private readonly sequences: SequenceService,
  ) {}

  async run(options: DemoSeedOptions): Promise<DemoSeedSummary> {
    this.summary = {};
    const rng = createRng(options.seed);

    // Platform-global catalogs, before any tenant data. The skill documents
    // `seed:demo:dev` as the first command against an empty database, so the
    // demo seed cannot assume the core seed ran: `seedDefaultRoles` resolves
    // every permission key to a catalog `_id` and hard-fails on an empty
    // `permissions` collection, and an empty carrier catalog forces every sold
    // deal through the "Other" escape. Both seeds are idempotent upserts on
    // tenant-agnostic rows, so re-running after the core seed is a no-op.
    await this.seedPlatformCatalogs();

    const { ctx } = await this.seedTenancy(options);
    if (options.fresh) {
      await this.purge(ctx.agencyId);
    }

    const team = await this.seedTeam(ctx, options);
    const producers = team.filter((m) => m.spec.roleSlug === 'producer');
    const crms = team.filter(
      (m) => m.spec.roleSlug === 'csr' || m.spec.roleSlug === 'crm',
    );

    const households = await this.seedHouseholds(ctx, crms, rng);
    const contactsByHousehold = await this.seedContacts(ctx, households, rng);
    // Leads -> quotes -> deals is a real chain now: each stage hangs off the
    // previous one's refs, mirroring the order the migration runs in.
    const leads = await this.seedLeads(
      ctx,
      producers,
      households,
      contactsByHousehold,
      rng,
    );
    const quotes = await this.seedQuotes(ctx, leads, rng);
    const deals = await this.seedDeals(ctx, leads, quotes, rng);
    const policies = await this.seedPolicies(ctx, deals, rng);

    await this.seedAuditTemplates(ctx);
    /*
     * Roll-ups **before** items (PAC-72): the board pages over `dealAudits`,
     * and an item needs its parent's `_id` to be loadable from a card. The
     * order used to be the other way round, which left the two collections
     * unlinked — invisible until the board tried to read them.
     */
    const auditIds = await this.seedDealAudits(ctx, deals, crms, rng);
    const dealsWithOpenItems = await this.seedDealAuditItems(
      ctx,
      deals,
      auditIds,
      rng,
    );
    await this.settleAuditStatuses(
      ctx,
      deals,
      auditIds,
      dealsWithOpenItems,
      rng,
    );
    await this.seedInterestedParties(ctx, policies, rng);
    await this.seedPriorInsurance(ctx, deals, rng);
    await this.seedPriorPolicies(ctx, deals, rng);

    await this.seedServiceTickets(ctx, crms, households, policies, rng);
    await this.seedProducerAssignments(ctx, producers, crms, rng);
    await this.seedCrmRotations(ctx, producers, crms);
    await this.seedTimeOffRequests(ctx, producers, rng);

    await this.seedProducerGoals(ctx, producers);
    await this.seedActivities(ctx, leads, quotes, deals, rng);
    // Last, and independent of everything above: a mailer is a cold prospect
    // who is deliberately *not* in the CRM yet — logging one as a lead is what
    // creates the household (PAC-61).
    const mailers = await this.seedMailers(ctx, rng);

    const logins = team.map((m) => ({
      email: m.email,
      role: m.spec.roleSlug,
      password: options.password,
    }));

    return {
      agencyId: ctx.agencyId,
      agencySlug: options.agencySlug,
      counts: this.summary,
      logins,
      sampleMailerControlNumbers: mailers.slice(0, 3),
    };
  }

  // ---------------------------------------------------------------------------
  // Platform-global catalogs: permission vocabulary + carriers
  // ---------------------------------------------------------------------------

  private async seedPlatformCatalogs(): Promise<void> {
    const permissions = await seedPermissions(this.permissionModel);
    this.inc('permissions', permissions.created + permissions.updated);

    const carriers = await seedCarriers(this.carrierModel);
    this.inc('carriers', carriers.created);
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

    await this.roleAssignments.seedDefaultRoles(agencyObjectId);

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

  private async seedTeam(
    ctx: Ctx,
    options: DemoSeedOptions,
  ): Promise<TeamMember[]> {
    const passwordHash = await bcrypt.hash(options.password, 10);
    // The default tenant keeps its historical keys so an existing database
    // reseeds in place; any other slug gets its own namespace, because
    // `legacySmartSuiteId` is globally unique on `users` and a second agency
    // must not steal the first one's rows.
    const isDefaultTenant = options.agencySlug === 'demo-agency';
    const userLegacyId = (key: string) =>
      isDefaultTenant
        ? `demo:user:${key}`
        : `demo:${options.agencySlug}:user:${key}`;

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
      const email = spec.email.replace(/@.*$/, `@${options.emailDomain}`);
      const user = await this.userModel.findOneAndUpdate(
        { email },
        {
          $set: {
            agencyId: ctx.agencyObjectId,
            branchId: branchObjectId,
            firstName: spec.firstName,
            lastName: spec.lastName,
            isActive: true,
            isPlatformAdmin: false,
            legacySmartSuiteId: userLegacyId(spec.key),
          },
          $setOnInsert: { passwordHash },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      // Through the join, and through the one writer — a direct `userRoles`
      // insert would skip cache invalidation and the owner-protection checks.
      // The seed acts as a platform admin: it must be able to assign the owner
      // role on a fresh tenant.
      await this.roleAssignments.setUserRoles(
        { userId: user._id.toString(), isPlatformAdmin: true },
        ctx.agencyObjectId,
        user._id,
        roleId ? [roleId] : [],
      );
      this.inc('users');
      team.push({
        spec,
        email,
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

    // Numbered in a pass afterwards rather than in the loop above, and via the
    // same reconcile the backfill uses. Assigning a fixed `HH-{i+1}` inline
    // looks tidier and is wrong: a local database usually also holds households
    // created through intake, and forcing the demo block onto `HH-1..24` would
    // collide with whatever those were already given. Allocating only for the
    // unnumbered keeps the seed idempotent — a re-run consumes nothing — while
    // a `--fresh` seed still produces `HH-1..24` in creation order.
    const refsAllocated = await reconcileHouseholdRefs(
      this.householdModel,
      this.sequences,
      ctx.agencyId,
    );
    this.logger.log(
      `Household refs: ${refsAllocated.allocated} allocated, ` +
        `${refsAllocated.alreadyNumbered} already numbered`,
    );

    return refs;
  }

  /**
   * Household rosters, returned keyed by household so leads can carry real
   * `primaryContactId`/`memberContactIds` refs rather than reaching their
   * contacts only through `legacyHouseholdId`.
   *
   * Also backfills the household's own `primaryContactId`/`memberContactIds`,
   * which `seedHouseholds` cannot set — it runs before the contacts exist.
   */
  private async seedContacts(
    ctx: Ctx,
    households: HouseholdRef[],
    rng: Rng,
  ): Promise<Map<string, ContactRef[]>> {
    const byHousehold = new Map<string, ContactRef[]>();
    let i = 0;
    for (const hh of households) {
      const roster: ContactRef[] = [];

      // Primary contact (the named insured).
      roster.push(
        await this.contact(ctx, rng, hh, i++, {
          firstName: hh.clientFirst,
          lastName: hh.clientLast,
          roleInHousehold: 'Primary',
          isPrimary: true,
        }),
      );
      // Spouse (~55%).
      if (rng.chance(0.55)) {
        roster.push(
          await this.contact(ctx, rng, hh, i++, {
            firstName: rng.pick(FIRST_NAMES),
            lastName: hh.clientLast,
            roleInHousehold: 'Spouse',
            isPrimary: false,
          }),
        );
      }
      // Additional member (~35%).
      if (rng.chance(0.35)) {
        roster.push(
          await this.contact(ctx, rng, hh, i++, {
            firstName: rng.pick(FIRST_NAMES),
            lastName: hh.clientLast,
            roleInHousehold: rng.pick([
              'Child',
              'Driver',
              'Additional Named Insured',
            ]),
            isPrimary: false,
          }),
        );
      }

      byHousehold.set(hh.legacyId, roster);

      await this.householdModel.updateOne(
        { agencyId: ctx.agencyId, legacySmartSuiteId: hh.legacyId },
        {
          $set: {
            primaryContactId: roster.find((c) => c.isPrimary)?.id,
            memberContactIds: roster
              .filter((c) => !c.isPrimary)
              .map((c) => c.id),
          },
        },
      );
    }
    return byHousehold;
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
  ): Promise<ContactRef> {
    const legacyId = `demo:contact:${index}`;
    const id = await this.upsert(
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
    return { id, legacyId, isPrimary: base.isPrimary };
  }

  // ---------------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------------

  /**
   * Leads, with status assigned by **pipeline position** rather than at random.
   *
   * The first `deals` leads are the ones that closed, the next `quotes - deals`
   * are the ones that got a proposal but not a sale, and the rest never made it
   * that far. `seedQuotes`/`seedDeals` then hang off this split, so a lead
   * marked `Sold` genuinely has a deal and a `Quoted` lead genuinely has a
   * recap — which is what makes the Lead Detail page testable at all.
   *
   * Leads are seeded before quotes and deals, so their `_id`s are available to
   * both — the same ordering the migration relies on.
   */
  private async seedLeads(
    ctx: Ctx,
    producers: TeamMember[],
    households: HouseholdRef[],
    contactsByHousehold: Map<string, ContactRef[]>,
    rng: Rng,
  ): Promise<LeadRef[]> {
    const refs: LeadRef[] = [];
    // Leads carrying a recap; of those, the leading `deals` also closed. The
    // surplus recaps (`repeatQuoteLeads`) become *second* recaps on sold leads
    // rather than first recaps on more leads — see `seedQuotes`.
    const quotedCount = Math.min(
      DEMO_CONFIG.quotes - DEMO_CONFIG.repeatQuoteLeads,
      DEMO_CONFIG.leads,
    );

    for (let i = 0; i < DEMO_CONFIG.leads; i++) {
      const producer = this.weightedProducer(producers, rng);
      const hh = this.householdForBranch(households, producer.branchSlug, rng);
      const roster = hh ? (contactsByHousehold.get(hh.legacyId) ?? []) : [];
      const primary = roster.find((c) => c.isPrimary);
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
      const status: string =
        i < DEMO_CONFIG.deals
          ? 'Sold'
          : i < quotedCount
            ? rng.pick<string>(['Quoted', 'Quoted', 'Requote'])
            : rng.pick<string>([...DEMO_LEAD_UNQUOTED_STATUSES]);
      const createdDate = this.daysAgo(rng.int(0, 45));
      // Never before the lead existed — a lead created 2 days ago cannot have
      // last been touched 6 days ago.
      const lastActivityAt = this.daysAgo(
        rng.int(0, Math.min(6, this.daysBetween(createdDate, this.now))),
      );
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
          // A quarter are left empty on purpose: every migrated lead, and every
          // one submitted before PAC-56 #2 shipped, has none — so the Lead
          // Detail card's "omit when empty" path has data to exercise locally.
          policiesOfInterest: rng.chance(0.75)
            ? rng.sample(POLICY_TYPES, rng.int(1, 3)).map((policyType) => ({
                policyType,
                // Only the vehicle types carry a count the form asks for;
                // everything else is one thing. Seeding 1–3 items on a Home
                // policy would put data in the demo tenant that no form can
                // produce — see `resolveItemCount`.
                itemCount: resolveItemCount(policyType, rng.int(1, 3)),
              }))
            : [],
          producerId: producer.userId,
          householdId: hh?.id,
          legacyHouseholdId: hh?.legacyId,
          primaryContactId: primary?.id,
          memberContactIds: roster.filter((c) => !c.isPrimary).map((c) => c.id),
          isTestRecord: false,
        },
      );
      this.inc('leads');
      refs.push({
        id,
        legacyId,
        producer,
        household: hh,
        occurredAt: createdDate,
        temperature,
        status,
      });
    }
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Quote recaps
  // ---------------------------------------------------------------------------

  /**
   * Quote recaps, each hung off the lead that produced it.
   *
   * One recap per quoted-or-sold lead, plus a second, older one for the first
   * `repeatQuoteLeads` sold leads — that is what populates the "N earlier
   * recaps" expander on the Lead Detail page, which was previously unreachable
   * in demo data.
   *
   * A lead's recaps are generated **together**, with their dates drawn from
   * inside that lead's own lifetime and sorted oldest-first. Drawing each recap
   * date independently is how you get a quote that predates the lead it belongs
   * to, which reads as corrupt on the timeline.
   *
   * Writes the resolved `leadId`/`householdId` refs, matching what the
   * migration now produces, so the read path is exercised the same way here as
   * it is on imported data.
   */
  private async seedQuotes(
    ctx: Ctx,
    leads: LeadRef[],
    rng: Rng,
  ): Promise<QuoteRef[]> {
    const refs: QuoteRef[] = [];

    // Lead order is pipeline order: sold first, then quoted-only.
    const quotedLeads = leads.filter((lead) =>
      ['Sold', 'Quoted', 'Requote'].includes(lead.status),
    );

    // How many recaps each lead gets: one, plus a second for the leading few.
    const surplus = Math.max(0, DEMO_CONFIG.quotes - quotedLeads.length);
    const plan = quotedLeads.map((lead, index) => ({
      lead,
      count: index < surplus ? 2 : 1,
    }));

    let i = 0;
    for (const { lead, count } of plan) {
      const producer = lead.producer;
      const hh = lead.household;
      // Every recap lands between the lead's creation and now; oldest first, so
      // the last one written is the current proposal.
      const leadAgeDays = this.daysBetween(lead.occurredAt, this.now);
      const offsets = Array.from({ length: count }, () =>
        rng.int(0, leadAgeDays),
      ).sort((a, b) => b - a);

      for (let n = 0; n < count; n++) {
        const isEarlier = n < count - 1;
        const quoteDate = this.daysAgo(offsets[n]);
        const products = rng.pick(POLICY_TYPE_SETS);
        const premium = rng.int(700, 5200);
        const legacyId = `demo:quote:${i++}`;

        const id = await this.upsert(
          this.quoteRecapModel,
          { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
          {
            agencyId: ctx.agencyId,
            branchId: producer.branchId,
            legacySmartSuiteId: legacyId,
            title: hh ? `${hh.name} — Quote` : `Quote ${i}`,
            quoteRecapAutoNumber: 1000 + i,
            quoteDate,
            // Written here so a fresh demo tenant drives the Quoted scorecard
            // (PAC-10) without anyone having to run the backfill first.
            quoteDateYmd: quoteDateYmd(quoteDate),
            premium,
            // Summed the way a real recap's rows sum: a vehicle line can
            // carry several, every other line carries exactly one.
            itemCount: products.reduce(
              (total, product) =>
                total + resolveItemCount(product, rng.int(1, 3)),
              0,
            ),
            productsQuoted: products,
            // PAC-56 #16 — seeded so the Quote Summary card and the edit form
            // have something to render locally.
            insuranceRenewalMonth: rng.pick([...INSURANCE_MONTHS]),
            recapStatus:
              lead.status === 'Sold' && !isEarlier
                ? 'Won'
                : rng.pick(['Submitted', 'Draft', 'Submitted']),
            producerId: producer.userId,
            leadId: lead.id,
            legacyLeadId: lead.legacyId,
            householdId: hh?.id,
            legacyHouseholdId: hh?.legacyId,
            isTestRecord: false,
          },
        );
        this.inc('quoteRecaps');
        refs.push({ id, legacyId, producer, lead, occurredAt: quoteDate });
      }
    }
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Deals (Sold Log)
  // ---------------------------------------------------------------------------

  /**
   * Deals — exactly one per `Sold` lead, linked to that lead's winning recap.
   *
   * Deals are no longer drawn independently: the lead, its household, its
   * producer and its quote all come from the same chain, so `GET /leads/:id`
   * resolves a real deal and `deals.quoteRecapId` points at the recap that
   * became the sale, matching what the SmartSuite migration produces.
   *
   * A lead without a household is skipped rather than paired with an unrelated
   * one; that only happens if no households were seeded.
   */
  private async seedDeals(
    ctx: Ctx,
    leads: LeadRef[],
    quotes: QuoteRef[],
    rng: Rng,
  ): Promise<DealRef[]> {
    const refs: DealRef[] = [];

    // Newest recap per lead — the one the sale closed on.
    const winningQuote = new Map<string, QuoteRef>();
    for (const quote of quotes) {
      const held = winningQuote.get(quote.lead.legacyId);
      if (!held || quote.occurredAt > held.occurredAt) {
        winningQuote.set(quote.lead.legacyId, quote);
      }
    }

    const soldLeads = leads.filter((lead) => lead.status === 'Sold');
    for (let i = 0; i < soldLeads.length; i++) {
      const lead = soldLeads[i];
      const hh = lead.household;
      if (!hh) continue;
      const producer = lead.producer;
      const policyTypes = rng.pick(POLICY_TYPE_SETS);
      const isBundle =
        policyTypes.some((t) => t.toLowerCase().includes('auto')) &&
        policyTypes.some((t) =>
          ['home', 'condo', 'renter'].some((k) => t.toLowerCase().includes(k)),
        );
      const dealType = deriveDealType(isBundle, policyTypes);
      const quote = winningQuote.get(lead.legacyId);
      // A sale cannot predate the quote it closed on, nor the lead itself.
      const earliest = quote?.occurredAt ?? lead.occurredAt;
      const soldDate = this.daysAgo(
        rng.int(0, this.daysBetween(earliest, this.now)),
      );
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
          // Summed the way `deriveDealAggregates` sums the real thing.
          itemCount: policyTypes.reduce(
            (total, policyType) =>
              total + resolveItemCount(policyType, rng.int(1, 3)),
            0,
          ),
          policyCount: policyTypes.length,
          dealType,
          isBundle,
          policyTypes,
          leadSource: { code: source.code, label: source.label },
          clientName,
          producerId: producer.userId,
          leadId: lead.id,
          legacyLeadId: lead.legacyId,
          householdId: hh.id,
          legacyHouseholdId: hh.legacyId,
          quoteRecapId: quote?.id,
          legacyQuoteRecapId: quote?.legacyId,
          /*
           * The display mirror of `DealAudit.auditStatus`, overwritten by
           * `seedDealAudits` below so the two always agree.
           *
           * Was `rng.pick(['Pending', 'In Progress', 'Complete'])` — two of
           * those are SmartSuite *labels* rather than the choice codes the app
           * stores, and the third was invented outright, so the demo tenant
           * disagreed with every other writer (PAC-72).
           */
          dealAuditStatus: DEFAULT_DEAL_AUDIT_STATUS,
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
        lead,
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
            // Digits only, because the carrier below is Allstate and PAC-56 #20
            // now enforces that format. Demo data has to satisfy the rules the
            // app enforces, or the first person to edit a seeded policy on the
            // Sold card gets a 400 on data we shipped them.
            policyNumber: `9${String(200000 + n).padStart(8, '0')}`,
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

  /**
   * The audit-template catalog is **core seed data** as of PAC-40, so this
   * delegates rather than owning its own copy.
   *
   * It used to upsert the same 21 templates keyed on
   * `legacySmartSuiteId: 'demo:tmpl:<i>'` while the core seed keys on
   * `{ agencyId, name }` — two different keys for one logical row, so running
   * both seeds produced 42 templates and every generated deal would have
   * matched a duplicate. The one-off cleanup below removes those phantoms from
   * databases seeded before this change.
   */
  private async seedAuditTemplates(ctx: Ctx): Promise<void> {
    const orphaned = await this.auditTemplateModel.deleteMany({
      agencyId: ctx.agencyId,
      legacySmartSuiteId: { $regex: '^demo:tmpl:' },
    });
    if (orphaned.deletedCount) {
      this.logger.log(
        `Removed ${orphaned.deletedCount} duplicate demo audit templates ` +
          '(superseded by the core seed catalog).',
      );
    }

    const { created, refreshed } = await seedAuditTemplates(
      this.auditTemplateModel,
      ctx.agencyId,
      ctx.defaultBranchId,
    );
    for (let i = 0; i < created + refreshed; i++) this.inc('auditTemplates');
  }

  /**
   * The per-deal checklist rows.
   *
   * Returns the deals that ended up with at least one **open** item, so
   * {@link settleAuditStatuses} can give each roll-up a workflow state that
   * matches its own items — a `Pass` sitting on a deal with three outstanding
   * documents is exactly the kind of incoherence that makes demo data
   * untrustworthy.
   */
  private async seedDealAuditItems(
    ctx: Ctx,
    deals: DealRef[],
    auditIds: Map<string, Types.ObjectId>,
    rng: Rng,
  ): Promise<Set<string>> {
    // Newest deals drive the hand-off board — generate items for the most recent.
    const recent = [...deals]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 16);

    const withOpenItems = new Set<string>();
    let n = 0;
    for (const deal of recent) {
      const applicable = this.applicableTemplates(deal, rng);
      // ~40% of recent deals still have open (failed, unresolved) items.
      const hasOpen = rng.chance(0.4);
      if (hasOpen && applicable.length) {
        withOpenItems.add(deal.legacyId);
      }
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
            // The link the board loads a card's checklist through (PAC-72).
            // Never set before, so items and roll-ups were two unrelated piles.
            dealAuditId: auditIds.get(deal.legacyId),
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
            // The soft 7-day deadline (PAC-65), from when the item was raised
            // rather than from now — so a demo tenant has a realistic mix of
            // overdue and upcoming for the board's `due` filter to show.
            dueAt: this.addDays(deal.occurredAt, AUDIT_ITEM_DUE_DAYS),
            isTestRecord: false,
          },
        );
        this.inc('dealAuditItems');
        n++;
      }
    }

    return withOpenItems;
  }

  /**
   * The per-deal roll-ups — one card each on the hand-off board.
   *
   * Returns `legacyId -> audit _id` so the item pass can link its rows.
   * `auditStatus` is deliberately **not** set here: it depends on whether the
   * items that come next are still open, and inventing it now is how the demo
   * tenant ended up claiming `Pass` on deals with outstanding documents. See
   * {@link settleAuditStatuses}.
   */
  private async seedDealAudits(
    ctx: Ctx,
    deals: DealRef[],
    crms: TeamMember[],
    rng: Rng,
  ): Promise<Map<string, Types.ObjectId>> {
    const recent = [...deals]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 16);
    const ids = new Map<string, Types.ObjectId>();
    let n = 0;
    for (const deal of recent) {
      const legacyId = `demo:dealaudit:${n}`;
      /*
       * Assignee is the selling producer, matching what `AuditGenerationService`
       * stamps on a real sale — "Pat Producer" is the data-rich hero the
       * Producer Dashboard is demoed with, so their board has to fill up.
       *
       * Reviewer is a CRM, which is the whole point of the two-role split: the
       * person who gathers the evidence is not the person who signs it off.
       */
      const reviewer = crms.length ? rng.pick(crms) : undefined;
      const id = await this.upsert(
        this.dealAuditModel,
        { agencyId: ctx.agencyId, legacySmartSuiteId: legacyId },
        {
          agencyId: ctx.agencyId,
          branchId: deal.producer.branchId,
          legacySmartSuiteId: legacyId,
          title: `${deal.clientName} — 24-Hour Audit`,
          auditId: `AUD-${9000 + n}`,
          auditDate: this.addDays(deal.occurredAt, 1),
          auditAssignee: { type: 'user', id: deal.producer.userId },
          auditReviewer: reviewer
            ? { type: 'user', id: reviewer.userId }
            : undefined,
          dealId: deal.id,
          legacyDealIds: [deal.legacyId],
          isTestRecord: false,
        },
      );
      ids.set(deal.legacyId, id);
      this.inc('dealAudits');
      n++;
    }
    return ids;
  }

  /**
   * Give each roll-up a workflow state consistent with its own checklist, then
   * recompute the board's counters.
   *
   * A deal with outstanding documents is somewhere in the working half of the
   * machine (`Not Submitted` / `Pending` / `Fail`); one with everything
   * resolved has passed. Reason codes and the score follow from that, using the
   * **real** vocabulary — the old seed picked from `['MISSING_DOC',
   * 'PREMIUM_VAR', 'SIG_MISSING']`, none of which are SmartSuite reason codes.
   *
   * Counters come from `reconcileDealAudits`, the same function the migration
   * calls, so a locally seeded tenant and a migrated one are consistent by
   * construction rather than by two implementations agreeing.
   */
  private async settleAuditStatuses(
    ctx: Ctx,
    deals: DealRef[],
    auditIds: Map<string, Types.ObjectId>,
    dealsWithOpenItems: Set<string>,
    rng: Rng,
  ): Promise<void> {
    for (const deal of deals) {
      const auditId = auditIds.get(deal.legacyId);
      if (!auditId) continue;

      const open = dealsWithOpenItems.has(deal.legacyId);
      const auditStatus: DealAuditStatus = open
        ? rng.pick(['Not Submitted', 'Not Submitted', 'Pending', 'Fail'])
        : 'Pass';
      const failed = auditStatus === 'Fail';

      await this.dealAuditModel.updateOne(
        { _id: auditId },
        {
          $set: {
            auditStatus,
            reasonCodes: failed
              ? rng.sample([...DEAL_AUDIT_REASON_CODES], rng.int(1, 2))
              : [],
            auditScore: open ? rng.int(60, 89) : rng.int(90, 100),
            auditNotes: open
              ? 'Follow-up required before full hand-off.'
              : 'All required documentation received.',
          },
        },
      );

      // The denormalized display copy on the sales record.
      await this.dealModel.updateOne(
        { _id: deal.id },
        { $set: { dealAuditStatus: auditStatus } },
      );
    }

    await reconcileDealAudits(
      {
        itemModel: this.dealAuditItemModel,
        dealAuditModel: this.dealAuditModel,
        dealModel: this.dealModel,
      },
      ctx.agencyId,
    );
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
          // PAC-65's vocabulary, not legacy's `Agent` / `Client` — the demo
          // tenant stands in for what the app writes today. The migration still
          // writes the legacy pair, which `LeadDetailService` normalizes on read.
          cancellationResponsibility: rng.pick(['SFA staff', 'Customer']),
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

  /**
   * A handful of mailer prospects (PAC-73).
   *
   * Exists so the Mailers drawer and the Add Mailers report are testable with
   * **neither** GCP credentials nor a real RTP file — both of which gate the
   * two real importers, and neither of which a new contributor will have.
   *
   * ## Deliberately not tied to demo households
   *
   * These are cold prospects who have been mailed a quote and are not clients.
   * That is the whole point of the flow: a producer looks one up by the number
   * printed on the mail piece and *then* a household and contact get created.
   * Reusing a seeded household here would make the drawer look like it works
   * while never exercising the path that matters.
   *
   * ## Why the idempotency key is not `demo:*`
   *
   * Every other demo collection upserts on `legacySmartSuiteId: 'demo:<type>:<n>'`,
   * and `Mailer` deliberately has no such field — mailers never lived in
   * SmartSuite. This follows the `ProducerGoal` exception instead and keys on
   * `source.recordSource`, which `purge()` also filters on.
   */
  private async seedMailers(
    ctx: Ctx,
    rng: Rng,
  ): Promise<{ long: string; short: string }[]> {
    const sample: { long: string; short: string }[] = [];
    const quoteDate = this.daysAgo(21);
    const weekNumber = 29;

    for (let i = 0; i < DEMO_CONFIG.mailers; i++) {
      // A stable, realistic-looking pair: a '#'-prefixed 32-hex "UUID" whose
      // last 12 characters are the short code — the exact relationship the real
      // data has, and what makes "either form resolves" worth testing.
      const hex = this.demoHex(i);
      const controlNumber = `#${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const newControlNumber = hex.slice(-12);

      const first = rng.pick(FIRST_NAMES);
      const last = rng.pick(LAST_NAMES);
      const city = rng.pick(MAILER_CITIES);
      const dwelling = rng.int(180, 900) * 1000;
      const monthly = rng.int(90, 260);

      await this.mailerModel.updateOne(
        {
          agencyId: ctx.agencyId,
          // `$in` over both forms, matching the unique index's domain — see
          // the note on the same filter in `common/mailers/mailer-import.ts`.
          controlNumberKeys: {
            $in: mailerControlNumberKeys(controlNumber, newControlNumber),
          },
        },
        {
          $set: {
            controlNumber,
            newControlNumber,
            firstName: first,
            lastName: last,
            fullName: `${first} ${last}`,
            gender: rng.chance(0.5) ? 'M' : 'F',
            address: {
              street: `${rng.int(100, 9999)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_SUFFIXES)}`,
              city: city.city,
              state: city.state,
              zip: `${city.zip}-${String(rng.int(1000, 9999))}`,
              zip5: city.zip,
              // Zero-padded FIPS, as the real column ships it. Seeded as a
              // string so anything rendering it hits the same case production
              // will, and a *real* Oklahoma code so the drawer can resolve it
              // to a county name — a random one would leave that row blank
              // forever and the resolution path untested.
              //
              // Every fifth mailer gets none, on purpose: the drawer omits the
              // county row rather than dashing it when the code is missing or
              // unmapped, and that branch needs something to exercise it.
              // Offset so the gap misses the first three — those are the ones
              // printed as samples at the end of the seed, and the number a
              // developer copies out of the log should show the whole drawer.
              county: i % 5 === 4 ? undefined : city.countyFips,
            },
            squareFeet: rng.int(1200, 4600),
            yearBuilt: rng.int(1955, 2020),
            coverage: {
              dwelling,
              otherStructures: Math.round(dwelling * 0.1),
              lossOfUse: Math.round(dwelling * 0.1),
              guestMedical: 1000,
              familyLiability: 100000,
            },
            // Both premiums, disagreeing — as they do on every real row. Kept
            // that way on purpose so nothing downstream can quietly start
            // treating them as interchangeable.
            premium: {
              total: rng.int(1400, 3400),
              yearly: monthly * 12,
              monthly,
              newYearly: monthly * 12,
            },
            campaign: {
              campaignNumber: `Week_Number-${weekNumber}`,
              weekNumber,
              fileName: 'SFA-20P',
              policyType: 'Home',
              product: 'FQ',
            },
            quoteDate,
            market: rng.pick(['Tulsa', 'Oklahoma City']),
            agencyPhone: '918-984-6163',
            doNotCall: false,
            // A couple of suppressed rows, because a producer cold-calling one
            // is a compliance problem and the UI has to show it.
            doNotMail: i % 7 === 0,
            isTestRecord: false,
            source: {
              system: 'spreadsheet',
              fileName: 'SFA-20P',
              uploadedFilename: 'demo-seed.csv',
              recordSource: 'demo:seed',
              uploadedAt: this.now,
            },
          },
          $setOnInsert: {
            agencyId: ctx.agencyId,
            controlNumberKeys: mailerControlNumberKeys(
              controlNumber,
              newControlNumber,
            ),
          },
        },
        { upsert: true },
      );
      this.inc('mailers');
      sample.push({ long: controlNumber, short: newControlNumber });
    }

    return sample;
  }

  /** 32 stable hex characters for demo mailer `i`. Not cryptographic. */
  private demoHex(index: number): string {
    // A fixed prefix plus the index makes every run produce the same numbers,
    // which is the only reason a developer can copy one out of the seed log
    // once and keep using it.
    // Hex characters only — a real control number is a UUID, and a demo one
    // carrying a stray 'm' would let a normalization bug that mangles
    // non-hex input pass here and fail on production data.
    return `d3d0${String(index).padStart(4, '0')}`
      .padEnd(16, 'a')
      .concat(`f00d${String(index).padStart(4, '0')}`.padEnd(16, 'b'));
  }

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
        userId: lead.producer.userId,
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
              userId: lead.producer.userId,
              // Clamped to the lead's own lifetime — a follow-up cannot have
              // happened before the lead was created.
              occurredAt: this.daysAgo(
                rng.int(
                  0,
                  Math.min(5, this.daysBetween(lead.occurredAt, this.now)),
                ),
              ),
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
        // The Lead Detail timeline reads `{ agencyId, leadId }`, so without
        // this the row exists but never renders on the lead it belongs to.
        leadId: quote.lead.id,
        userId: quote.producer.userId,
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
        leadId: deal.lead.id,
        userId: deal.producer.userId,
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
    // Same exception as producer goals: `Mailer` has no `legacySmartSuiteId`,
    // so it is keyed and purged on its provenance marker instead.
    await this.mailerModel.deleteMany({
      agencyId,
      'source.recordSource': 'demo:seed',
    });

    // Reset the household counter too, so a `--fresh` seed is actually
    // reproducible rather than climbing `HH-44`, `HH-68`, … on every run.
    // Safe because `reconcileHouseholdRefs` seeds the counter from the highest
    // reference still stored before it allocates anything, so households that
    // survived the purge (anything not `demo:`-prefixed) keep their numbers and
    // cannot have one reissued underneath them.
    await this.sequences.reset(householdCounterKey(agencyId));

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

  /**
   * A plausible checklist for a demo deal.
   *
   * Categories are the production vocabulary (`Common | Auto | Home |
   * Landlord`, see `audit-templates.seed.ts`) — this used to branch on
   * `Property` and `Prior Insurance`, which no longer exist. The gating mirrors
   * the real generator's policy-type rules; the randomness on top is what makes
   * the demo board look lived-in rather than uniformly complete.
   */
  private applicableTemplates(deal: DealRef, rng: Rng) {
    const isLandlord = deal.policyTypes.some((t) =>
      t.toLowerCase().includes('landlord'),
    );
    const isHome = deal.policyTypes.some((t) =>
      ['home', 'condo', 'dwelling', 'renter'].some((k) =>
        t.toLowerCase().includes(k),
      ),
    );
    const isAuto = deal.policyTypes.some(
      (t) =>
        t.toLowerCase().includes('auto') ||
        t.toLowerCase().includes('motorcycle'),
    );
    return AUDIT_TEMPLATES.filter((t) => {
      if (t.alwaysInclude) return true;
      if (t.category === 'Common') return true;
      if (t.category === 'Auto') return isAuto && rng.chance(0.5);
      if (t.category === 'Home') return isHome && rng.chance(0.6);
      if (t.category === 'Landlord') return isLandlord && rng.chance(0.6);
      // Applies to any line, so no policy-type gate — just how often a demo
      // deal was sold to someone with prior coverage (PAC-65 #15).
      if (t.category === 'Prior Insurance') return rng.chance(0.6);
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
