import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  formatHouseholdRef,
  normalizeCarrier,
  normalizeInsuranceMonth,
  parseHouseholdRef,
} from '@sfa/shared';
import { Agency } from '../platform/schemas/agency.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { User } from '../users/schemas/user.schema';
import { SequenceService } from '../common/mongo/sequence.service';
import { reconcileHouseholdRefs } from '../households/household-ref';
import { Household } from '../households/schemas/household.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { quoteDateYmd } from '../quote-recaps/quote.normalize';
import { QuoteRecap } from '../quote-recaps/schemas/quote-recap.schema';
import { Deal } from '../deals/schemas/deal.schema';
import { DealAuditItem } from '../deal-audit-items/schemas/deal-audit-item.schema';
import { Activity } from '../activities/schemas/activity.schema';
import { ProducerGoal } from '../producer-goals/schemas/producer-goal.schema';
import { Contact } from '../contacts/schemas/contact.schema';
import { Policy } from '../policies/schemas/policy.schema';
import { ServiceTicket } from '../service-tickets/schemas/service-ticket.schema';
import { DealAudit } from '../deal-audits/schemas/deal-audit.schema';
import { InterestedParty } from '../interested-parties/schemas/interested-party.schema';
import { PriorInsurance } from '../prior-insurance/schemas/prior-insurance.schema';
import { PriorPolicy } from '../prior-policies/schemas/prior-policy.schema';
import { ProducerAssignment } from '../producer-assignments/schemas/producer-assignment.schema';
import { CrmRotation } from '../crm-rotations/schemas/crm-rotation.schema';
import { TimeOffRequest } from '../time-off-requests/schemas/time-off-request.schema';
import { AuditTemplate } from '../audit-templates/schemas/audit-template.schema';
import {
  SmartSuiteClient,
  loadSmartSuiteConfig,
} from './smartsuite/smartsuite.client';
import { SMARTSUITE_TABLE_IDS } from './smartsuite/table-ids';
import {
  AUDIT_TEMPLATE_FIELDS,
  CONTACT_FIELDS,
  CRM_ROTATION_FIELDS,
  DEAL_AUDIT_CATEGORY_LABELS,
  DEAL_AUDIT_FIELDS,
  DEAL_AUDIT_ITEM_FIELDS,
  DEAL_AUDIT_ITEM_NAME_LABELS,
  DEAL_AUDIT_STATUS_LABELS,
  DEAL_AUDIT_UPDATE_STATUS_LABELS,
  DEAL_FIELDS,
  HOUSEHOLD_FIELDS,
  INTERESTED_PARTY_FIELDS,
  LEAD_FIELDS,
  POLICY_FIELDS,
  PRIOR_INSURANCE_FIELDS,
  PRIOR_POLICY_FIELDS,
  PRODUCER_ASSIGNMENT_FIELDS,
  QUOTE_RECAP_FIELDS,
  SERVICE_TICKET_FIELDS,
  TIME_OFF_REQUEST_FIELDS,
  USER_FIELDS,
} from './smartsuite/field-ids';
import {
  allLinkedIds,
  firstLinkedId,
  selectCode,
  toBool,
  toDate,
  toNumber,
  toPhoneArray,
  toStringArray,
  toText,
  toYmd,
} from './helpers/value-utils';
import {
  isTestRecord,
  normalizeLeadSource,
  normalizePolicyType,
} from '@sfa/shared';
import {
  daysSince,
  deriveDealType,
  normalizeTemperature,
  policyTypeLabels,
  resolvePremium,
} from './helpers/derive';
import {
  CollectionStat,
  MigrationReport,
  createReport,
  emptyStat,
} from './report';

export interface MigrationOptions {
  dryRun: boolean;
  agencySlug: string;
  branchSlug: string;
  pageSize: number;
}

interface TenantCtx {
  agencyId: string;
  branchId: string;
  agencyObjectId: Types.ObjectId;
  branchObjectId: Types.ObjectId;
  dryRun: boolean;
}

interface ProducerEntry {
  userId: Types.ObjectId;
  name: string;
  monthlyGoal: number;
}

interface LeadRef {
  id: Types.ObjectId;
  legacyId: string;
  producerId?: Types.ObjectId;
  occurredAt?: Date;
  isTest: boolean;
}

interface QuoteRef {
  id: Types.ObjectId;
  legacyId: string;
  producerId?: Types.ObjectId;
  /** Resolved lead, so the derived `quoted` activity lands on the timeline. */
  leadId?: Types.ObjectId;
  occurredAt?: Date;
  isTest: boolean;
}

interface DealRef {
  dealId: Types.ObjectId;
  legacyId: string;
  producerId?: Types.ObjectId;
  /** Resolved lead, so the derived `sold` activity lands on the timeline. */
  leadId?: Types.ObjectId;
  occurredAt?: Date;
  clientName?: string;
  isTest: boolean;
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger('Migration');

  constructor(
    @InjectModel(Agency.name) private readonly agencyModel: Model<Agency>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<Household>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecap>,
    @InjectModel(Deal.name) private readonly dealModel: Model<Deal>,
    @InjectModel(DealAuditItem.name)
    private readonly dealAuditItemModel: Model<DealAuditItem>,
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(ProducerGoal.name)
    private readonly producerGoalModel: Model<ProducerGoal>,
    @InjectModel(Contact.name) private readonly contactModel: Model<Contact>,
    @InjectModel(Policy.name) private readonly policyModel: Model<Policy>,
    @InjectModel(ServiceTicket.name)
    private readonly serviceTicketModel: Model<ServiceTicket>,
    @InjectModel(DealAudit.name)
    private readonly dealAuditModel: Model<DealAudit>,
    @InjectModel(InterestedParty.name)
    private readonly interestedPartyModel: Model<InterestedParty>,
    @InjectModel(PriorInsurance.name)
    private readonly priorInsuranceModel: Model<PriorInsurance>,
    @InjectModel(PriorPolicy.name)
    private readonly priorPolicyModel: Model<PriorPolicy>,
    @InjectModel(ProducerAssignment.name)
    private readonly producerAssignmentModel: Model<ProducerAssignment>,
    @InjectModel(CrmRotation.name)
    private readonly crmRotationModel: Model<CrmRotation>,
    @InjectModel(TimeOffRequest.name)
    private readonly timeOffRequestModel: Model<TimeOffRequest>,
    @InjectModel(AuditTemplate.name)
    private readonly auditTemplateModel: Model<AuditTemplate>,
    private readonly sequences: SequenceService,
  ) {}

  async run(options: MigrationOptions): Promise<MigrationReport> {
    const report = createReport(options.dryRun);
    const started = Date.now();
    const ss = new SmartSuiteClient(loadSmartSuiteConfig());

    const ctx = await this.resolveTenant(options, report);

    const producers = await this.migrateUsers(ss, ctx, options, report);
    report.producers.mapped = producers.size;

    const households = await this.migrateHouseholds(
      ss,
      ctx,
      producers,
      options,
      report,
    );
    await this.migrateContacts(ss, ctx, households, options, report);
    const leads = await this.migrateLeads(ss, ctx, producers, options, report);

    // Legacy id -> Mongo `_id`, so recaps and deals can be written with real
    // `leadId` refs rather than only the `legacyLeadId` string. Leads are
    // migrated before both, so this map is always complete by the time it is
    // read; the same holds for `households` and, below, `quoteIds`.
    const leadIds = new Map(leads.map((lead) => [lead.legacyId, lead.id]));

    const quotes = await this.migrateQuoteRecaps(
      ss,
      ctx,
      producers,
      households,
      leadIds,
      options,
      report,
    );
    const quoteIds = new Map(quotes.map((quote) => [quote.legacyId, quote.id]));

    const deals = await this.migrateDeals(
      ss,
      ctx,
      producers,
      households,
      leadIds,
      quoteIds,
      options,
      report,
    );
    const policies = await this.migratePolicies(
      ss,
      ctx,
      households,
      deals,
      options,
      report,
    );
    await this.migrateAuditItems(ss, ctx, deals, options, report);
    await this.migrateDealAudits(ss, ctx, deals, options, report);
    await this.migrateAuditTemplates(ss, ctx, options, report);
    await this.migrateInterestedParties(
      ss,
      ctx,
      households,
      policies,
      options,
      report,
    );
    await this.migratePriorInsurance(
      ss,
      ctx,
      producers,
      households,
      deals,
      options,
      report,
    );
    await this.migratePriorPolicies(
      ss,
      ctx,
      households,
      deals,
      options,
      report,
    );
    await this.migrateServiceTickets(
      ss,
      ctx,
      producers,
      households,
      policies,
      options,
      report,
    );
    await this.migrateProducerAssignments(ss, ctx, producers, options, report);
    await this.migrateCrmRotations(ss, ctx, producers, options, report);
    await this.migrateTimeOffRequests(ss, ctx, producers, options, report);

    await this.deriveProducerGoals(ctx, producers, report);
    await this.deriveActivities(ctx, leads, quotes, deals, report);

    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - started;
    return report;
  }

  /** Resolve a legacy link id to a Mongo ObjectId via a prebuilt map. */
  private ref(
    legacyId: string | undefined,
    map: Map<string, Types.ObjectId>,
  ): Types.ObjectId | undefined {
    return legacyId ? map.get(legacyId) : undefined;
  }

  /** A producer/user link's Mongo _id from the producers map. */
  private userRef(
    legacyId: string | undefined,
    producers: Map<string, ProducerEntry>,
  ): Types.ObjectId | undefined {
    return legacyId ? producers.get(legacyId)?.userId : undefined;
  }

  // ---------------------------------------------------------------------------
  // Tenant
  // ---------------------------------------------------------------------------

  private async resolveTenant(
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<TenantCtx> {
    const agency = await this.agencyModel
      .findOne({ slug: options.agencySlug })
      .lean();
    if (!agency) {
      throw new Error(
        `Agency '${options.agencySlug}' not found. Run the API seed first (npm run seed:dev).`,
      );
    }
    const branch = await this.branchModel
      .findOne({ agencyId: agency._id, slug: options.branchSlug })
      .lean();
    if (!branch) {
      throw new Error(
        `Branch '${options.branchSlug}' not found for agency '${options.agencySlug}'.`,
      );
    }
    report.agency = { id: agency._id.toString(), slug: agency.slug };
    report.branch = { id: branch._id.toString(), slug: branch.slug };
    return {
      agencyId: agency._id.toString(),
      branchId: branch._id.toString(),
      agencyObjectId: agency._id,
      branchObjectId: branch._id,
      dryRun: options.dryRun,
    };
  }

  // ---------------------------------------------------------------------------
  // Users -> producer map
  // ---------------------------------------------------------------------------

  private async migrateUsers(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<Map<string, ProducerEntry>> {
    const stat = emptyStat();
    report.collections.users = stat;
    const map = new Map<string, ProducerEntry>();

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.users);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.users,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const firstName = toText(rec[USER_FIELDS.firstName]);
      const lastName = toText(rec[USER_FIELDS.lastName]);
      const name = [firstName, lastName].filter(Boolean).join(' ').trim();
      const monthlyGoal = toNumber(rec[USER_FIELDS.monthlyGoal]);
      const emails = toStringArray(rec[USER_FIELDS.email]);
      const email =
        emails[0]?.toLowerCase() ?? `legacy-${legacyId}@migrated.local`;
      const employeeActive =
        selectCode(rec[USER_FIELDS.employeeStatus]) === 'D7jD5' ||
        toBool(rec[USER_FIELDS.isActive]);

      try {
        const userId = await this.upsert(
          this.userModel,
          { legacySmartSuiteId: legacyId },
          {
            agencyId: ctx.agencyObjectId,
            branchId: ctx.branchObjectId,
            email,
            firstName,
            lastName,
            isActive: employeeActive,
            legacySmartSuiteId: legacyId,
          },
          {
            passwordHash: randomBytes(24).toString('hex'),
            roleIds: [],
          },
          ctx.dryRun,
        );
        map.set(legacyId, { userId, name, monthlyGoal });
        stat.migrated += ctx.dryRun ? 0 : 1;
      } catch (err) {
        stat.skipped++;
        report.errors.push(
          `user ${legacyId} (${email}): ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Users: fetched ${stat.fetched}, mapped ${map.size} producers`,
    );
    return map;
  }

  private resolveProducer(
    legacyProducerId: string | undefined,
    producers: Map<string, ProducerEntry>,
    report: MigrationReport,
  ): ProducerEntry | undefined {
    if (!legacyProducerId) return undefined;
    const entry = producers.get(legacyProducerId);
    if (!entry && !report.producers.unmapped.includes(legacyProducerId)) {
      report.producers.unmapped.push(legacyProducerId);
    }
    return entry;
  }

  // ---------------------------------------------------------------------------
  // Households
  // ---------------------------------------------------------------------------

  private async migrateHouseholds(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<Map<string, Types.ObjectId>> {
    const stat = emptyStat();
    report.collections.households = stat;
    const map = new Map<string, Types.ObjectId>();

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.households);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.households,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const name =
        toText(rec[HOUSEHOLD_FIELDS.householdName]) ??
        toText(rec[HOUSEHOLD_FIELDS.normalizedPrimaryName]);
      const test = isTestRecord(null, name, toText(rec.title));
      if (test) stat.excludedTest++;

      // `#HH2614` -> `HH-2614`. A title that was never numbered (SmartSuite's
      // "Record 1" placeholder, or free text someone typed) yields null and the
      // household stays unnumbered until the backfill allocates one — inventing
      // a number here would risk colliding with a real one further down the run.
      const refSeq = parseHouseholdRef(
        toText(rec[HOUSEHOLD_FIELDS.householdRef]),
      );

      const legacyCrmId = firstLinkedId(rec[HOUSEHOLD_FIELDS.assignedCrm]);
      const crm = legacyCrmId ? producers.get(legacyCrmId) : undefined;

      const id = await this.persist(
        this.householdModel,
        ctx,
        legacyId,
        {
          householdRef:
            refSeq === null ? undefined : formatHouseholdRef(refSeq),
          name,
          status: selectCode(rec[HOUSEHOLD_FIELDS.status]),
          propertyAddress: this.asObject(rec[HOUSEHOLD_FIELDS.propertyAddress]),
          mailingAddress: this.asObject(rec[HOUSEHOLD_FIELDS.mailingAddress]),
          primaryEmails: this.deepEmails(rec[HOUSEHOLD_FIELDS.primaryEmail]),
          primaryPhones: this.deepPhones(rec[HOUSEHOLD_FIELDS.primaryPhone]),
          assignedCrmId: crm?.userId,
          legacyAssignedCrmId: legacyCrmId,
          totalActivePolicies: toNumber(
            rec[HOUSEHOLD_FIELDS.totalActivePolicies],
          ),
          isTestRecord: test,
        },
        stat,
        report,
      );
      if (id) map.set(legacyId, id);
    }

    // Leaves the agency's household numbering consistent in one pass, so the
    // migration is self-sufficient and needs no follow-up script:
    //
    //  1. Seeds the counter above the highest `#HH…` just imported. This has to
    //     happen before anything can create a household in this agency —
    //     starting from zero would hand `HH-1` to a new household while a
    //     migrated one already holds it, and the unique index would reject it.
    //  2. Allocates for whatever is left unnumbered: a legacy title that was
    //     never a number, and — the case re-running the import cannot otherwise
    //     reach — households created natively through intake, which carry no
    //     `legacySmartSuiteId` and so are never matched by the loop above.
    //
    // Shared with the demo seed, which is why a local reseed leaves the same
    // consistent state without going near SmartSuite.
    if (!ctx.dryRun) {
      const refs = await reconcileHouseholdRefs(
        this.householdModel,
        this.sequences,
        ctx.agencyId,
      );
      this.logger.log(
        `Households: fetched ${stat.fetched}, refs — ${refs.alreadyNumbered} ` +
          `from legacy (highest HH-${refs.seededTo}), ${refs.allocated} allocated`,
      );
    } else {
      this.logger.log(`Households: fetched ${stat.fetched} (dry run)`);
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  private async migrateContacts(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    households: Map<string, Types.ObjectId>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.contacts = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.contacts);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.contacts,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const firstName = toText(rec[CONTACT_FIELDS.firstName]);
      const lastName = toText(rec[CONTACT_FIELDS.lastName]);
      const name = [firstName, lastName].filter(Boolean).join(' ');
      const test = isTestRecord(null, name, toText(rec.title));
      if (test) stat.excludedTest++;

      const legacyHouseholdId = firstLinkedId(rec[CONTACT_FIELDS.household]);

      await this.persist(
        this.contactModel,
        ctx,
        legacyId,
        {
          firstName,
          lastName,
          emails: toStringArray(rec[CONTACT_FIELDS.email]),
          phones: toPhoneArray(rec[CONTACT_FIELDS.phone]),
          dateOfBirth: toDate(rec[CONTACT_FIELDS.dateOfBirth]),
          roleInHousehold: selectCode(rec[CONTACT_FIELDS.roleInHousehold]),
          isPrimary: toBool(rec[CONTACT_FIELDS.isPrimary]),
          notes: toText(rec[CONTACT_FIELDS.notes]),
          householdId: this.ref(legacyHouseholdId, households),
          legacyHouseholdId,
          isTestRecord: test,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Contacts: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------------

  private async migrateLeads(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<LeadRef[]> {
    const stat = emptyStat();
    report.collections.leads = stat;
    const refs: LeadRef[] = [];

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.leads);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.leads,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const firstName = toText(rec[LEAD_FIELDS.firstName]);
      const lastName = toText(rec[LEAD_FIELDS.lastName]);
      const rawSource = rec[LEAD_FIELDS.leadSource];
      const leadSource = normalizeLeadSource(
        selectCode(rawSource),
        this.selectLabel(rawSource),
      );
      const name = [firstName, lastName].filter(Boolean).join(' ');
      const test = isTestRecord(leadSource, name);
      if (test) stat.excludedTest++;

      const producer = this.resolveProducer(
        firstLinkedId(rec[LEAD_FIELDS.producer]),
        producers,
        report,
      );
      const createdDate = toDate(rec[LEAD_FIELDS.createdDate]);
      const lastActivityAt =
        toDate(rec[LEAD_FIELDS.lastUpdated]) ?? createdDate;

      const id = await this.persist(
        this.leadModel,
        ctx,
        legacyId,
        {
          firstName,
          lastName,
          emails: toStringArray(rec[LEAD_FIELDS.email]),
          phones: toPhoneArray(rec[LEAD_FIELDS.phone]),
          status: selectCode(rec[LEAD_FIELDS.status]),
          temperature: normalizeTemperature(rec[LEAD_FIELDS.temperature]),
          leadSource: { code: leadSource.code, label: leadSource.label },
          agingDays: daysSince(createdDate),
          createdDate,
          lastActivityAt,
          quoteControlNumber: toText(rec[LEAD_FIELDS.quoteControlNumber]),
          producerId: producer?.userId,
          legacyProducerId: firstLinkedId(rec[LEAD_FIELDS.producer]),
          legacyHouseholdId: firstLinkedId(rec[LEAD_FIELDS.household]),
          isTestRecord: test,
        },
        stat,
        report,
      );

      if (id) {
        refs.push({
          id,
          legacyId,
          producerId: producer?.userId,
          occurredAt: createdDate,
          isTest: test,
        });
      }
    }
    this.logger.log(`Leads: fetched ${stat.fetched}`);
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Quote Recaps
  // ---------------------------------------------------------------------------

  /**
   * Quote recaps.
   *
   * Writes the **resolved** `leadId`/`householdId` alongside the `legacy*`
   * strings. Historically only the legacy ids were written, which left every
   * migrated recap unreachable from `GET /leads/:id` — that query is
   * `{ agencyId, leadId }` — and made `quoteRecaps.leadId` useless for
   * reporting. `backfill-deal-refs` repaired deals but never these.
   *
   * An unresolved link stays `undefined` rather than being guessed at; Mongoose
   * strips it from the `$set`, so the `legacy*` string remains the only record
   * and the read-path fallback still covers it.
   */
  private async migrateQuoteRecaps(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    households: Map<string, Types.ObjectId>,
    leadIds: Map<string, Types.ObjectId>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<QuoteRef[]> {
    const stat = emptyStat();
    report.collections.quoteRecaps = stat;
    const refs: QuoteRef[] = [];
    let unlinked = 0;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.quoteRecaps);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.quoteRecaps,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const producer = this.resolveProducer(
        firstLinkedId(rec[QUOTE_RECAP_FIELDS.producer]),
        producers,
        report,
      );
      const test = isTestRecord(null, producer?.name, toText(rec.title));
      if (test) stat.excludedTest++;
      const quoteDate = toDate(rec[QUOTE_RECAP_FIELDS.quoteDate]);

      const legacyLeadId = firstLinkedId(rec[QUOTE_RECAP_FIELDS.lead]);
      const legacyHouseholdId = firstLinkedId(
        rec[QUOTE_RECAP_FIELDS.household],
      );
      const leadId = this.ref(legacyLeadId, leadIds);
      if (legacyLeadId && !leadId) unlinked++;

      const id = await this.persist(
        this.quoteRecapModel,
        ctx,
        legacyId,
        {
          title: toText(rec.title),
          quoteDate,
          // The Quoted scorecard's bucket key (PAC-10). Written on import so a
          // freshly migrated agency needs no backfill pass; `backfill:deal-refs`
          // exists for agencies migrated before PAC-9.
          quoteDateYmd: quoteDate ? quoteDateYmd(quoteDate) : undefined,
          premium: toNumber(rec[QUOTE_RECAP_FIELDS.premium]),
          itemCount: toNumber(rec[QUOTE_RECAP_FIELDS.items]),
          // Normalized to canonical labels (PAC-39). This field historically
          // stored raw SmartSuite choice codes while `deals.policyTypes` and
          // the demo seed stored labels; because `persist` `$set`s the field, a
          // re-run heals the code-holding documents already in Mongo.
          productsQuoted: this.selectCodes(
            rec[QUOTE_RECAP_FIELDS.productsQuoted],
          ).map(normalizePolicyType),
          // "Insurance X Month" (PAC-56 #16). Mapped to the month label at
          // write, not left as SmartSuite's choice UUID — the read paths
          // normalize too, so a re-run heals recaps imported before this.
          insuranceRenewalMonth:
            normalizeInsuranceMonth(
              selectCode(rec[QUOTE_RECAP_FIELDS.insuranceMonth]),
            ) || undefined,
          recapStatus: selectCode(rec[QUOTE_RECAP_FIELDS.recapStatus]),
          producerId: producer?.userId,
          legacyProducerId: firstLinkedId(rec[QUOTE_RECAP_FIELDS.producer]),
          leadId,
          legacyLeadId,
          householdId: this.ref(legacyHouseholdId, households),
          legacyHouseholdId,
          isTestRecord: test,
        },
        stat,
        report,
      );

      if (id) {
        refs.push({
          id,
          legacyId,
          producerId: producer?.userId,
          leadId,
          occurredAt: quoteDate,
          isTest: test,
        });
      }
    }
    this.logger.log(
      `Quote Recaps: fetched ${stat.fetched}` +
        (unlinked ? ` (${unlinked} with an unresolvable lead link)` : ''),
    );
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Deals (Sold Log)
  // ---------------------------------------------------------------------------

  /**
   * Deals (Sold Log).
   *
   * Resolves the same refs `backfill-deal-refs` was written to repair
   * (`leadId`, `householdId`, `quoteRecapId`) at import time instead. The
   * backfill stays — it is the only remedy for databases migrated before this
   * — but a fresh migration no longer needs it.
   */
  private async migrateDeals(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    households: Map<string, Types.ObjectId>,
    leadIds: Map<string, Types.ObjectId>,
    quoteIds: Map<string, Types.ObjectId>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<Map<string, DealRef>> {
    const stat = emptyStat();
    report.collections.deals = stat;
    const map = new Map<string, DealRef>();
    let unlinked = 0;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.deals);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.deals,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const rawSource = rec[DEAL_FIELDS.leadSource];
      const leadSource = normalizeLeadSource(
        selectCode(rawSource),
        this.selectLabel(rawSource),
      );
      const clientName = toText(rec[DEAL_FIELDS.clientName]);
      const producer = this.resolveProducer(
        firstLinkedId(rec[DEAL_FIELDS.producer]),
        producers,
        report,
      );
      const test = isTestRecord(leadSource, clientName, producer?.name);
      if (test) stat.excludedTest++;

      const { premium, source } = resolvePremium(
        rec[DEAL_FIELDS.premiumRollup],
        rec[DEAL_FIELDS.premiumSnapshot],
      );
      const soldDate = toDate(rec[DEAL_FIELDS.soldDate]);
      const policyLabels = policyTypeLabels(rec[DEAL_FIELDS.policyTypes]);
      const isBundle = toBool(rec[DEAL_FIELDS.bundle]);

      const legacyLeadId = firstLinkedId(rec[DEAL_FIELDS.lead]);
      const legacyHouseholdId = firstLinkedId(rec[DEAL_FIELDS.household]);
      const legacyQuoteRecapId = firstLinkedId(rec[DEAL_FIELDS.quoteRecap]);
      const leadId = this.ref(legacyLeadId, leadIds);
      if (legacyLeadId && !leadId) unlinked++;

      const id = await this.persist(
        this.dealModel,
        ctx,
        legacyId,
        {
          title: toText(rec[DEAL_FIELDS.title]),
          dealAutoNumber: toNumber(rec[DEAL_FIELDS.autonumber]) || undefined,
          soldDate,
          soldDateYmd:
            toNumber(rec[DEAL_FIELDS.soldDateYmd]) || toYmd(soldDate),
          premium,
          premiumSource: source,
          itemCount: toNumber(rec[DEAL_FIELDS.totalItems]),
          policyCount: toNumber(rec[DEAL_FIELDS.policyCount]),
          dealType: deriveDealType(isBundle, policyLabels),
          isBundle,
          policyTypes: policyLabels,
          leadSource: { code: leadSource.code, label: leadSource.label },
          clientName,
          producerId: producer?.userId,
          legacyProducerId: firstLinkedId(rec[DEAL_FIELDS.producer]),
          leadId,
          legacyLeadId,
          householdId: this.ref(legacyHouseholdId, households),
          legacyHouseholdId,
          quoteRecapId: this.ref(legacyQuoteRecapId, quoteIds),
          legacyQuoteRecapId,
          dealAuditStatus: selectCode(rec[DEAL_FIELDS.dealAuditStatus]),
          status: selectCode(rec[DEAL_FIELDS.status]),
          isTestRecord: test,
        },
        stat,
        report,
      );

      if (id) {
        map.set(legacyId, {
          dealId: id,
          legacyId,
          producerId: producer?.userId,
          leadId,
          occurredAt: soldDate,
          clientName,
          isTest: test,
        });
      }
    }
    this.logger.log(
      `Deals: fetched ${stat.fetched}` +
        (unlinked ? ` (${unlinked} with an unresolvable lead link)` : ''),
    );
    return map;
  }

  // ---------------------------------------------------------------------------
  // Deal Audit Items -> dealAuditItems
  // ---------------------------------------------------------------------------

  private async migrateAuditItems(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    deals: Map<string, DealRef>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.dealAuditItems = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.dealAuditItems);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.dealAuditItems,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyDealId = firstLinkedId(rec[DEAL_AUDIT_ITEM_FIELDS.deal]);
      const deal = legacyDealId ? deals.get(legacyDealId) : undefined;

      const statusCode = selectCode(rec[DEAL_AUDIT_ITEM_FIELDS.status]);
      const updateStatusCode = selectCode(
        rec[DEAL_AUDIT_ITEM_FIELDS.updateStatus],
      );
      const itemCode = selectCode(rec[DEAL_AUDIT_ITEM_FIELDS.itemName]);
      const categoryCode = selectCode(rec[DEAL_AUDIT_ITEM_FIELDS.category]);
      const clientName = toText(
        rec[DEAL_AUDIT_ITEM_FIELDS.normalizedClientName],
      );
      const producerName = toText(
        rec[DEAL_AUDIT_ITEM_FIELDS.normalizedProducerName],
      );
      const firstCreatedAt = toDate(rec[DEAL_AUDIT_ITEM_FIELDS.firstCreated]);
      const test = deal?.isTest ?? isTestRecord(null, clientName, producerName);
      if (test) stat.excludedTest++;

      await this.persist(
        this.dealAuditItemModel,
        ctx,
        legacyId,
        {
          title: toText(rec[DEAL_AUDIT_ITEM_FIELDS.title]),
          dealId: deal?.dealId,
          legacyDealId,
          itemName: itemCode
            ? (DEAL_AUDIT_ITEM_NAME_LABELS[itemCode] ?? itemCode)
            : undefined,
          category: categoryCode
            ? (DEAL_AUDIT_CATEGORY_LABELS[categoryCode] ?? categoryCode)
            : undefined,
          status: statusCode,
          statusLabel: statusCode
            ? DEAL_AUDIT_STATUS_LABELS[statusCode]
            : undefined,
          updateStatus: updateStatusCode,
          updateStatusLabel: updateStatusCode
            ? DEAL_AUDIT_UPDATE_STATUS_LABELS[updateStatusCode]
            : undefined,
          isFailed: statusCode === 'in_progress',
          isResolved: updateStatusCode === 'complete',
          required: toBool(rec[DEAL_AUDIT_ITEM_FIELDS.required]),
          blocking: toBool(rec[DEAL_AUDIT_ITEM_FIELDS.blocking]),
          applicable: toBool(rec[DEAL_AUDIT_ITEM_FIELDS.applicable]),
          clientName,
          producerName,
          producerId: deal?.producerId,
          daysOpen:
            toNumber(rec[DEAL_AUDIT_ITEM_FIELDS.daysOpen]) ||
            daysSince(firstCreatedAt),
          firstCreatedAt,
          isTestRecord: test,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Audit items: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Policies
  // ---------------------------------------------------------------------------

  private async migratePolicies(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    households: Map<string, Types.ObjectId>,
    deals: Map<string, DealRef>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<Map<string, Types.ObjectId>> {
    const stat = emptyStat();
    report.collections.policies = stat;
    const map = new Map<string, Types.ObjectId>();

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.policies);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.policies,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyHouseholdId = firstLinkedId(rec[POLICY_FIELDS.household]);
      const legacyDealId = firstLinkedId(rec[POLICY_FIELDS.deal]);
      const deal = legacyDealId ? deals.get(legacyDealId) : undefined;
      const test = deal?.isTest ?? false;
      if (test) stat.excludedTest++;

      const id = await this.persist(
        this.policyModel,
        ctx,
        legacyId,
        {
          policyNumber: toText(rec[POLICY_FIELDS.policyNumber]),
          policyType: selectCode(rec[POLICY_FIELDS.policyType]),
          // Mapped at write as well as normalized on read (PAC-56 #19): the raw
          // `B4tEH` was being rendered to users, and mapping only on read would
          // leave the stored value un-matchable against the carrier catalog.
          carrier: normalizeCarrier(selectCode(rec[POLICY_FIELDS.carrier])),
          active: toBool(rec[POLICY_FIELDS.active]),
          effectiveDate: toDate(rec[POLICY_FIELDS.effectiveDate]),
          expirationDate: toDate(rec[POLICY_FIELDS.expirationDate]),
          renewalDate: toDate(rec[POLICY_FIELDS.renewalDate]),
          premium: toNumber(rec[POLICY_FIELDS.premium]),
          items: toNumber(rec[POLICY_FIELDS.items]),
          policyStatus: selectCode(rec[POLICY_FIELDS.policyStatus]),
          notes: toText(rec[POLICY_FIELDS.notes]),
          householdId: this.ref(legacyHouseholdId, households),
          legacyHouseholdId,
          dealId: deal?.dealId,
          legacyDealId,
          isTestRecord: test,
        },
        stat,
        report,
      );
      if (id) map.set(legacyId, id);
    }
    this.logger.log(`Policies: fetched ${stat.fetched}`);
    return map;
  }

  // ---------------------------------------------------------------------------
  // Deal Audits (parent audit summaries)
  // ---------------------------------------------------------------------------

  private async migrateDealAudits(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    deals: Map<string, DealRef>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.dealAudits = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.dealAudits);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.dealAudits,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyDealIds = allLinkedIds(rec[DEAL_AUDIT_FIELDS.deals]);
      const firstDeal = legacyDealIds[0]
        ? deals.get(legacyDealIds[0])
        : undefined;
      const test = firstDeal?.isTest ?? false;
      if (test) stat.excludedTest++;

      await this.persist(
        this.dealAuditModel,
        ctx,
        legacyId,
        {
          title: toText(rec[DEAL_AUDIT_FIELDS.title]),
          auditId: toText(rec[DEAL_AUDIT_FIELDS.auditId]),
          auditDate: toDate(rec[DEAL_AUDIT_FIELDS.auditDate]),
          result: selectCode(rec[DEAL_AUDIT_FIELDS.result]),
          reasonCodes: this.selectCodes(rec[DEAL_AUDIT_FIELDS.reasonCodes]),
          auditScore: toNumber(rec[DEAL_AUDIT_FIELDS.auditScore]),
          auditNotes: toText(rec[DEAL_AUDIT_FIELDS.auditNotes]),
          dealId: firstDeal?.dealId,
          legacyDealIds,
          isTestRecord: test,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Deal audits: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Audit Templates
  // ---------------------------------------------------------------------------

  private async migrateAuditTemplates(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.auditTemplates = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.auditTemplates);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.auditTemplates,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const categoryCode = selectCode(rec[AUDIT_TEMPLATE_FIELDS.category]);
      await this.persist(
        this.auditTemplateModel,
        ctx,
        legacyId,
        {
          name: toText(rec[AUDIT_TEMPLATE_FIELDS.name]),
          category: categoryCode
            ? (DEAL_AUDIT_CATEGORY_LABELS[categoryCode] ?? categoryCode)
            : undefined,
          required: toBool(rec[AUDIT_TEMPLATE_FIELDS.required]),
          blocking: toBool(rec[AUDIT_TEMPLATE_FIELDS.blocking]),
          active: toBool(rec[AUDIT_TEMPLATE_FIELDS.active]),
          alwaysInclude: toBool(rec[AUDIT_TEMPLATE_FIELDS.alwaysInclude]),
          task: toText(rec[AUDIT_TEMPLATE_FIELDS.task]),
        },
        stat,
        report,
      );
    }
    this.logger.log(`Audit templates: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Interested Parties
  // ---------------------------------------------------------------------------

  private async migrateInterestedParties(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    households: Map<string, Types.ObjectId>,
    policies: Map<string, Types.ObjectId>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.interestedParties = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.interestedParties);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.interestedParties,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyPolicyId = firstLinkedId(rec[INTERESTED_PARTY_FIELDS.policy]);
      const legacyHouseholdId = firstLinkedId(
        rec[INTERESTED_PARTY_FIELDS.household],
      );

      await this.persist(
        this.interestedPartyModel,
        ctx,
        legacyId,
        {
          title: toText(rec[INTERESTED_PARTY_FIELDS.title]),
          status: selectCode(rec[INTERESTED_PARTY_FIELDS.status]),
          priority: selectCode(rec[INTERESTED_PARTY_FIELDS.priority]),
          mortgagee: toText(rec[INTERESTED_PARTY_FIELDS.mortgagee]),
          loanNumber: toText(rec[INTERESTED_PARTY_FIELDS.loanNumber]),
          address: this.asObject(rec[INTERESTED_PARTY_FIELDS.address]),
          notes: toText(rec[INTERESTED_PARTY_FIELDS.notes]),
          policyId: this.ref(legacyPolicyId, policies),
          legacyPolicyId,
          householdId: this.ref(legacyHouseholdId, households),
          legacyHouseholdId,
          isTestRecord: false,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Interested parties: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Prior Insurance
  // ---------------------------------------------------------------------------

  private async migratePriorInsurance(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    households: Map<string, Types.ObjectId>,
    deals: Map<string, DealRef>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.priorInsurance = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.priorInsurance);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.priorInsurance,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyDealId = firstLinkedId(rec[PRIOR_INSURANCE_FIELDS.deal]);
      const legacyHouseholdId = firstLinkedId(
        rec[PRIOR_INSURANCE_FIELDS.household],
      );
      const legacyProducerId = firstLinkedId(
        rec[PRIOR_INSURANCE_FIELDS.producer],
      );
      const deal = legacyDealId ? deals.get(legacyDealId) : undefined;
      const test = deal?.isTest ?? false;
      if (test) stat.excludedTest++;

      await this.persist(
        this.priorInsuranceModel,
        ctx,
        legacyId,
        {
          title: toText(rec[PRIOR_INSURANCE_FIELDS.title]),
          cancellationResponsibility: selectCode(
            rec[PRIOR_INSURANCE_FIELDS.cancellationResponsibility],
          ),
          cancelledPreviousInsurance: selectCode(
            rec[PRIOR_INSURANCE_FIELDS.cancelledPreviousInsurance],
          ),
          cancellationDate: toDate(
            rec[PRIOR_INSURANCE_FIELDS.cancellationDate],
          ),
          autoHomeSameCarrier: selectCode(
            rec[PRIOR_INSURANCE_FIELDS.autoHomeSameCarrier],
          ),
          previousCarrierAuto: toText(
            rec[PRIOR_INSURANCE_FIELDS.previousCarrierAuto],
          ),
          previousCarrierHome: toText(
            rec[PRIOR_INSURANCE_FIELDS.previousCarrierHome],
          ),
          previousAgentName: toText(
            rec[PRIOR_INSURANCE_FIELDS.previousAgentName],
          ),
          dealId: deal?.dealId,
          legacyDealId,
          householdId: this.ref(legacyHouseholdId, households),
          legacyHouseholdId,
          producerId: this.userRef(legacyProducerId, producers),
          legacyProducerId,
          isTestRecord: test,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Prior insurance: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Prior Policies
  // ---------------------------------------------------------------------------

  private async migratePriorPolicies(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    households: Map<string, Types.ObjectId>,
    deals: Map<string, DealRef>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.priorPolicies = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.priorPolicies);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.priorPolicies,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyDealId = firstLinkedId(rec[PRIOR_POLICY_FIELDS.deal]);
      const legacyHouseholdId = firstLinkedId(
        rec[PRIOR_POLICY_FIELDS.household],
      );
      const legacyPriorInsuranceId = firstLinkedId(
        rec[PRIOR_POLICY_FIELDS.priorInsurance],
      );
      const deal = legacyDealId ? deals.get(legacyDealId) : undefined;
      const test = deal?.isTest ?? false;
      if (test) stat.excludedTest++;

      await this.persist(
        this.priorPolicyModel,
        ctx,
        legacyId,
        {
          title: toText(rec[PRIOR_POLICY_FIELDS.title]),
          cancellationStatus: selectCode(rec[PRIOR_POLICY_FIELDS.status]),
          policyType: selectCode(rec[PRIOR_POLICY_FIELDS.policyType]),
          needsCancellation: selectCode(
            rec[PRIOR_POLICY_FIELDS.needsCancellation],
          ),
          cancellationDate: toDate(rec[PRIOR_POLICY_FIELDS.cancellationDate]),
          accordFormNeeded: selectCode(
            rec[PRIOR_POLICY_FIELDS.accordFormNeeded],
          ),
          previousCarrier: toText(rec[PRIOR_POLICY_FIELDS.previousCarrier]),
          notes: toText(rec[PRIOR_POLICY_FIELDS.notes]),
          completedDate: toDate(rec[PRIOR_POLICY_FIELDS.completedDate]),
          dealId: deal?.dealId,
          legacyDealId,
          householdId: this.ref(legacyHouseholdId, households),
          legacyHouseholdId,
          legacyPriorInsuranceId,
          isTestRecord: test,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Prior policies: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Service Tickets
  // ---------------------------------------------------------------------------

  private async migrateServiceTickets(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    households: Map<string, Types.ObjectId>,
    policies: Map<string, Types.ObjectId>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.serviceTickets = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.serviceTickets);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.serviceTickets,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyPolicyId = firstLinkedId(rec[SERVICE_TICKET_FIELDS.policy]);
      const legacyHouseholdId = firstLinkedId(
        rec[SERVICE_TICKET_FIELDS.household],
      );
      const legacyAssignedCrmId = firstLinkedId(
        rec[SERVICE_TICKET_FIELDS.assignedCrm],
      );
      const legacyCreatedById = firstLinkedId(
        rec[SERVICE_TICKET_FIELDS.createdBy],
      );
      const clientName = toText(rec[SERVICE_TICKET_FIELDS.clientName]);
      const test = isTestRecord(null, clientName, toText(rec.title));
      if (test) stat.excludedTest++;
      const firstCreatedAt = toDate(rec[SERVICE_TICKET_FIELDS.firstCreated]);

      await this.persist(
        this.serviceTicketModel,
        ctx,
        legacyId,
        {
          title: toText(rec[SERVICE_TICKET_FIELDS.title]),
          createdDate:
            toDate(rec[SERVICE_TICKET_FIELDS.createdDate]) ?? firstCreatedAt,
          category: selectCode(rec[SERVICE_TICKET_FIELDS.category]),
          priority: selectCode(rec[SERVICE_TICKET_FIELDS.priority]),
          dueDate: toDate(rec[SERVICE_TICKET_FIELDS.dueDate]),
          status: selectCode(rec[SERVICE_TICKET_FIELDS.status]),
          dateResolved: toDate(rec[SERVICE_TICKET_FIELDS.dateResolved]),
          daysOpen:
            toNumber(rec[SERVICE_TICKET_FIELDS.daysOpen]) ||
            daysSince(firstCreatedAt),
          clientName,
          crmName: toText(rec[SERVICE_TICKET_FIELDS.crmName]),
          policyId: this.ref(legacyPolicyId, policies),
          legacyPolicyId,
          householdId: this.ref(legacyHouseholdId, households),
          legacyHouseholdId,
          assignedCrmId: this.userRef(legacyAssignedCrmId, producers),
          legacyAssignedCrmId,
          createdById: this.userRef(legacyCreatedById, producers),
          legacyCreatedById,
          isTestRecord: test,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Service tickets: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Producer Assignments
  // ---------------------------------------------------------------------------

  private async migrateProducerAssignments(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.producerAssignments = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.producerAssignments);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.producerAssignments,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyProducerId = firstLinkedId(
        rec[PRODUCER_ASSIGNMENT_FIELDS.producer],
      );
      const legacyCrmId = firstLinkedId(
        rec[PRODUCER_ASSIGNMENT_FIELDS.lastAssignedCrm],
      );

      await this.persist(
        this.producerAssignmentModel,
        ctx,
        legacyId,
        {
          title: toText(rec[PRODUCER_ASSIGNMENT_FIELDS.title]),
          indexPointer: toNumber(rec[PRODUCER_ASSIGNMENT_FIELDS.indexPointer]),
          activeForProducer: toBool(
            rec[PRODUCER_ASSIGNMENT_FIELDS.activeForProducer],
          ),
          lastAssignedAt: toDate(
            rec[PRODUCER_ASSIGNMENT_FIELDS.lastAssignedAt],
          ),
          lock: toBool(rec[PRODUCER_ASSIGNMENT_FIELDS.lock]),
          producerId: this.userRef(legacyProducerId, producers),
          legacyProducerId,
          lastAssignedCrmId: this.userRef(legacyCrmId, producers),
          legacyLastAssignedCrmId: legacyCrmId,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Producer assignments: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // CRM Rotations
  // ---------------------------------------------------------------------------

  private async migrateCrmRotations(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.crmRotations = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.crmRotations);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.crmRotations,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyCrmId = firstLinkedId(rec[CRM_ROTATION_FIELDS.crm]);
      const legacyProducerId = firstLinkedId(rec[CRM_ROTATION_FIELDS.producer]);

      await this.persist(
        this.crmRotationModel,
        ctx,
        legacyId,
        {
          title: toText(rec[CRM_ROTATION_FIELDS.title]),
          order: toNumber(rec[CRM_ROTATION_FIELDS.order]),
          activeForProducer: toBool(rec[CRM_ROTATION_FIELDS.activeForProducer]),
          crmId: this.userRef(legacyCrmId, producers),
          legacyCrmId,
          producerId: this.userRef(legacyProducerId, producers),
          legacyProducerId,
        },
        stat,
        report,
      );
    }
    this.logger.log(`CRM rotations: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Time Off Requests
  // ---------------------------------------------------------------------------

  private async migrateTimeOffRequests(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.timeOffRequests = stat;

    stat.source = await ss.count(SMARTSUITE_TABLE_IDS.timeOffRequests);
    const records = await ss.listAll(
      SMARTSUITE_TABLE_IDS.timeOffRequests,
      {},
      options.pageSize,
    );
    stat.fetched = records.length;

    for (const rec of records) {
      const legacyId = rec.id as string;
      if (!legacyId) {
        stat.skipped++;
        continue;
      }
      const legacyProducerId = firstLinkedId(
        rec[TIME_OFF_REQUEST_FIELDS.producer],
      );

      await this.persist(
        this.timeOffRequestModel,
        ctx,
        legacyId,
        {
          title: toText(rec[TIME_OFF_REQUEST_FIELDS.title]),
          startDate: toDate(rec[TIME_OFF_REQUEST_FIELDS.startDate]),
          endDate: toDate(rec[TIME_OFF_REQUEST_FIELDS.endDate]),
          requestType: selectCode(rec[TIME_OFF_REQUEST_FIELDS.requestType]),
          hoursRequested: toNumber(rec[TIME_OFF_REQUEST_FIELDS.hoursRequested]),
          status: selectCode(rec[TIME_OFF_REQUEST_FIELDS.status]),
          type: selectCode(rec[TIME_OFF_REQUEST_FIELDS.type]),
          decision: selectCode(rec[TIME_OFF_REQUEST_FIELDS.decision]),
          producerId: this.userRef(legacyProducerId, producers),
          legacyProducerId,
        },
        stat,
        report,
      );
    }
    this.logger.log(`Time off requests: fetched ${stat.fetched}`);
  }

  // ---------------------------------------------------------------------------
  // Derived: producerGoals
  // ---------------------------------------------------------------------------

  private async deriveProducerGoals(
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    report: MigrationReport,
  ): Promise<void> {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    let created = 0;
    for (const [legacyId, entry] of producers) {
      if (entry.monthlyGoal <= 0) continue;
      if (!ctx.dryRun) {
        await this.producerGoalModel.updateOne(
          {
            agencyId: ctx.agencyId,
            producerId: entry.userId,
            month,
          },
          {
            $set: {
              branchId: ctx.branchId,
              goalPremium: entry.monthlyGoal,
              legacyProducerId: legacyId,
              source: 'migration:user-monthly-goal',
            },
          },
          { upsert: true },
        );
      }
      created++;
    }
    report.derived.producerGoals = created;
    this.logger.log(`Producer goals: ${created} for ${month}`);
  }

  // ---------------------------------------------------------------------------
  // Derived: activities (lead created / quoted / sold timeline)
  // ---------------------------------------------------------------------------

  private async deriveActivities(
    ctx: TenantCtx,
    leads: LeadRef[],
    quotes: QuoteRef[],
    deals: Map<string, DealRef>,
    report: MigrationReport,
  ): Promise<void> {
    let created = 0;

    const emit = async (
      key: string,
      doc: Record<string, unknown>,
    ): Promise<void> => {
      if (!ctx.dryRun) {
        await this.activityModel.updateOne(
          { agencyId: ctx.agencyId, legacySmartSuiteId: key },
          {
            $set: {
              branchId: ctx.branchId,
              legacySmartSuiteId: key,
              ...doc,
            },
          },
          { upsert: true },
        );
      }
      created++;
    };

    for (const lead of leads) {
      if (lead.isTest || !lead.occurredAt) continue;
      await emit(`lead_created:${lead.legacyId}`, {
        type: 'lead_created',
        subjectType: 'lead',
        legacySubjectId: lead.legacyId,
        leadId: lead.id,
        producerId: lead.producerId,
        occurredAt: lead.occurredAt,
        summary: 'Lead created',
      });
    }
    for (const quote of quotes) {
      if (quote.isTest || !quote.occurredAt) continue;
      await emit(`quoted:${quote.legacyId}`, {
        type: 'quoted',
        subjectType: 'quoteRecap',
        legacySubjectId: quote.legacyId,
        // Without this the row exists but is invisible: the Lead Detail
        // timeline reads `{ agencyId, leadId }`, so before recaps carried a
        // resolved lead ref only `lead_created` ever appeared on migrated data.
        leadId: quote.leadId,
        producerId: quote.producerId,
        occurredAt: quote.occurredAt,
        summary: 'Quote recap created',
      });
    }
    for (const deal of deals.values()) {
      if (deal.isTest || !deal.occurredAt) continue;
      await emit(`sold:${deal.legacyId}`, {
        type: 'sold',
        subjectType: 'deal',
        legacySubjectId: deal.legacyId,
        dealId: deal.dealId,
        leadId: deal.leadId,
        producerId: deal.producerId,
        occurredAt: deal.occurredAt,
        summary: deal.clientName
          ? `Deal sold: ${deal.clientName}`
          : 'Deal sold',
      });
    }

    report.derived.activities = created;
    this.logger.log(`Activities: ${created}`);
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  /**
   * Idempotent upsert for a tenant-scoped, SmartSuite-sourced record keyed on
   * { agencyId, legacySmartSuiteId }. Updates the report stat and returns the
   * Mongo _id (a throwaway ObjectId in dry-run).
   */
  private async persist<T>(
    model: Model<T>,
    ctx: TenantCtx,
    legacyId: string,
    fields: Record<string, unknown>,
    stat: CollectionStat,
    report: MigrationReport,
  ): Promise<Types.ObjectId | undefined> {
    try {
      const id = await this.upsert(
        model,
        {
          agencyId: ctx.agencyId,
          legacySmartSuiteId: legacyId,
        },
        {
          agencyId: ctx.agencyId,
          branchId: ctx.branchId,
          legacySmartSuiteId: legacyId,
          ...fields,
        },
        {},
        ctx.dryRun,
      );
      stat.migrated += ctx.dryRun ? 0 : 1;
      return id;
    } catch (err) {
      stat.skipped++;
      report.errors.push(
        `${model.modelName} ${legacyId}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private async upsert<T>(
    model: Model<T>,
    filter: FilterQuery<T>,
    set: Record<string, unknown>,
    setOnInsert: Record<string, unknown>,
    dryRun: boolean,
  ): Promise<Types.ObjectId> {
    if (dryRun) return new Types.ObjectId();
    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(setOnInsert).length) update.$setOnInsert = setOnInsert;
    const doc = await model
      .findOneAndUpdate(filter, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        projection: { _id: 1 },
      })
      .lean();
    return (doc as unknown as { _id: Types.ObjectId })._id;
  }

  // ---------------------------------------------------------------------------
  // Small extraction helpers
  // ---------------------------------------------------------------------------

  private asObject(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return undefined;
  }

  private selectLabel(value: unknown): string | undefined {
    const o = this.asObject(value);
    if (!o) return undefined;
    const label = o.label ?? o.display_value;
    return typeof label === 'string' ? label : undefined;
  }

  private selectCodes(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map((v: unknown) => selectCode(v))
        .filter((v): v is string => typeof v === 'string');
    }
    const code = selectCode(value);
    return code ? [code] : [];
  }

  private deepFlatten(value: unknown): unknown[] {
    const out: unknown[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && v !== undefined) out.push(v);
    };
    walk(value);
    return out;
  }

  private deepEmails(value: unknown): string[] {
    return this.deepFlatten(value)
      .filter((v): v is string => typeof v === 'string' && v.includes('@'))
      .map((v) => v.toLowerCase());
  }

  private deepPhones(value: unknown): string[] {
    return this.deepFlatten(value)
      .map((v): string => {
        if (typeof v === 'string') return v;
        const o = this.asObject(v);
        return o && typeof o.phone_number === 'string' ? o.phone_number : '';
      })
      .filter((v) => v.length > 0);
  }
}
