import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  formatHouseholdRef,
  normalizeCarrier,
  normalizeDealAuditStatus,
  normalizeInsuranceMonth,
  parseHouseholdRef,
} from '@sfa/shared';
import { reconcileDealAudits } from '../deal-audits/audit-reconcile';
import { Agency } from '../platform/schemas/agency.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { User } from '../users/schemas/user.schema';
import { SequenceService } from '../common/mongo/sequence.service';
import { reconcileHouseholdRefs } from '../households/household-ref';
import { Household } from '../households/schemas/household.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { auditItemDueAt } from '../audit-generation/audit-due';
import { normalizePolicyNumber } from '../policies/policy-number';
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
  MAX_POLICIES_PER_RECORD,
  isPlausibleItemCount,
  isPlausiblePolicyCount,
  isTestRecord,
  maxPlausibleItemCount,
  normalizeCancellationResponsibility,
  normalizeContactRole,
  normalizeHouseholdStatus,
  normalizeLeadSource,
  normalizeLegacyTicketCategory,
  normalizeLegacyTicketStatus,
  normalizePolicyStatus,
  normalizePolicyType,
  normalizePriorPolicyCancellationStatus,
  normalizePriorPolicyType,
  normalizeTimeOffDecision,
  normalizeTimeOffRequestType,
  normalizeTimeOffStatus,
  normalizeTimeOffType,
} from '@sfa/shared';
import {
  daysSince,
  deriveDealType,
  normalizeTemperature,
  policyTypeLabels,
  resolvePremium,
} from './helpers/derive';
import { recentChicagoMonths } from '../performance/performance.range';
import {
  CollectionStat,
  MigrationReport,
  createReport,
  emptyStat,
  MigrationRunError,
  recordRejection,
} from './report';

/**
 * Marks the goal rows this import owns, so a future goal-setting UI's rows are
 * distinguishable from derived ones and a re-run can tell them apart.
 */
const GOAL_SOURCE = 'migration:user-monthly-goal';

/**
 * How many months of producer goals to write, counting back from the current
 * Chicago month.
 *
 * A year, because SmartSuite holds one standing goal with no month dimension and
 * the leaderboard is queryable per month: writing only the current one left
 * every historical month blank and expired the goals at the next rollover. A
 * year is the range a Motivation Hub is ever asked about.
 */
const GOAL_MONTHS_WRITTEN = 12;

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

/**
 * Stages in `run()`, for the `[n/N]` progress label. Purely cosmetic — drift
 * mislabels a log line, it cannot break the run — but keep it in step with the
 * `this.step(...)` calls in `run()`.
 */
const MIGRATION_STEP_COUNT = 21;

/**
 * How many failed rows to log as they happen. A table that fails wholesale
 * would otherwise produce thousands of identical warnings and bury the stage
 * lines; the full list always survives in the JSON report.
 */
const ERROR_LOG_LIMIT = 25;

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * The stat split an operator actually reads, with the zero-valued parts left
 * out so a clean table logs one short line and a troubled one stands out.
 */
function summarizeStat(stat: CollectionStat): string {
  const parts = [`${stat.fetched} fetched`, `${stat.migrated} migrated`];
  // Only worth saying when it disagrees with what we actually pulled.
  if (stat.source && stat.source !== stat.fetched) {
    parts.push(`${stat.source} at source`);
  }
  if (stat.skipped) parts.push(`${stat.skipped} skipped`);
  if (stat.excludedTest) parts.push(`${stat.excludedTest} test`);
  if (stat.rejectedValues) parts.push(`${stat.rejectedValues} rejected values`);
  const links = stat.producerLinks;
  if (links) {
    parts.push(
      `producers ${links.linked} linked/${links.unresolved} unresolved/` +
        `${links.absent} unattributed`,
    );
  }
  return parts.join(', ');
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger('Migration');
  /** Position in the `run()` sequence, for the `[n/N]` progress label. */
  private stepIndex = 0;
  /** Row errors logged live so far; the rest are left to the JSON report. */
  private loggedErrors = 0;

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
    this.stepIndex = 0;
    this.loggedErrors = 0;
    const ss = new SmartSuiteClient(loadSmartSuiteConfig());

    this.logger.log(
      `Migration starting — agency=${options.agencySlug} branch=${options.branchSlug} ` +
        `pageSize=${options.pageSize}` +
        (options.dryRun ? ' (DRY RUN — nothing is written)' : ''),
    );

    try {
      const ctx = await this.step(report, 'Tenant', null, () =>
        this.resolveTenant(options, report),
      );

      const producers = await this.step(report, 'Users', 'users', () =>
        this.migrateUsers(ss, ctx, options, report),
      );
      report.producers.mapped = producers.size;

      const households = await this.step(
        report,
        'Households',
        'households',
        () => this.migrateHouseholds(ss, ctx, producers, options, report),
      );
      await this.step(report, 'Contacts', 'contacts', () =>
        this.migrateContacts(ss, ctx, households, options, report),
      );
      const leads = await this.step(report, 'Leads', 'leads', () =>
        this.migrateLeads(ss, ctx, producers, options, report),
      );

      // Legacy id -> Mongo `_id`, so recaps and deals can be written with real
      // `leadId` refs rather than only the `legacyLeadId` string. Leads are
      // migrated before both, so this map is always complete by the time it is
      // read; the same holds for `households` and, below, `quoteIds`.
      const leadIds = new Map(leads.map((lead) => [lead.legacyId, lead.id]));

      const quotes = await this.step(
        report,
        'Quote Recaps',
        'quoteRecaps',
        () =>
          this.migrateQuoteRecaps(
            ss,
            ctx,
            producers,
            households,
            leadIds,
            options,
            report,
          ),
      );
      const quoteIds = new Map(
        quotes.map((quote) => [quote.legacyId, quote.id]),
      );

      const deals = await this.step(report, 'Deals', 'deals', () =>
        this.migrateDeals(
          ss,
          ctx,
          producers,
          households,
          leadIds,
          quoteIds,
          options,
          report,
        ),
      );
      const policies = await this.step(report, 'Policies', 'policies', () =>
        this.migratePolicies(ss, ctx, households, deals, options, report),
      );
      await this.step(report, 'Audit items', 'dealAuditItems', () =>
        this.migrateAuditItems(ss, ctx, deals, options, report),
      );
      await this.step(report, 'Deal audits', 'dealAudits', () =>
        this.migrateDealAudits(ss, ctx, deals, options, report),
      );
      /*
       * Must follow both passes (PAC-72). Items import before roll-ups, so an
       * item cannot know its parent's `_id` at import time, and legacy has no
       * audit assignee at all. Without this the hand-off board — which pages over
       * `dealAudits` and scopes on `auditAssignee` — shows nothing for any
       * migrated deal.
       */
      await this.step(report, 'Audit reconciliation', null, () =>
        this.reconcileAudits(ctx),
      );
      await this.step(report, 'Audit templates', 'auditTemplates', () =>
        this.migrateAuditTemplates(ss, ctx, options, report),
      );
      await this.step(report, 'Interested parties', 'interestedParties', () =>
        this.migrateInterestedParties(
          ss,
          ctx,
          households,
          policies,
          options,
          report,
        ),
      );
      await this.step(report, 'Prior insurance', 'priorInsurance', () =>
        this.migratePriorInsurance(
          ss,
          ctx,
          producers,
          households,
          deals,
          options,
          report,
        ),
      );
      await this.step(report, 'Prior policies', 'priorPolicies', () =>
        this.migratePriorPolicies(ss, ctx, households, deals, options, report),
      );
      await this.step(report, 'Service tickets', 'serviceTickets', () =>
        this.migrateServiceTickets(
          ss,
          ctx,
          producers,
          households,
          policies,
          options,
          report,
        ),
      );
      await this.step(
        report,
        'Producer assignments',
        'producerAssignments',
        () =>
          this.migrateProducerAssignments(ss, ctx, producers, options, report),
      );
      await this.step(report, 'CRM rotations', 'crmRotations', () =>
        this.migrateCrmRotations(ss, ctx, producers, options, report),
      );
      await this.step(report, 'Time-off requests', 'timeOffRequests', () =>
        this.migrateTimeOffRequests(ss, ctx, producers, options, report),
      );

      await this.step(report, 'Producer goals (derived)', null, () =>
        this.deriveProducerGoals(ctx, producers, report),
      );
      await this.step(report, 'Activities (derived)', null, () =>
        this.deriveActivities(ctx, leads, quotes, deals, report),
      );
    } catch (err) {
      /*
       * Stamp and report the partial run before rethrowing. Everything the
       * completed stages measured is still true and still worth having; the
       * caller decides how loudly to surface it.
       */
      this.finish(report, started, false);
      throw new MigrationRunError(report, err);
    }

    this.finish(report, started, true);
    return report;
  }

  /** Stamp the run's end on the report and log the closing tally. */
  private finish(
    report: MigrationReport,
    started: number,
    completed: boolean,
  ): void {
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - started;
    this.logSummary(report, completed);
  }

  /**
   * Run one stage with uniform progress logging.
   *
   * Each stage used to log a single bespoke line of its own choosing, so a run
   * that died partway — as a dropped SmartSuite connection will make it — left
   * no record of which stage was in flight, how far the run had got, or how
   * long anything took. The outcome line is built from the stage's own
   * `CollectionStat`, which is already where the migrated/skipped/rejected
   * split lives, so stages need no per-stage logging code of their own.
   */
  private async step<T>(
    report: MigrationReport,
    label: string,
    statKey: string | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    const tag = `[${++this.stepIndex}/${MIGRATION_STEP_COUNT}] ${label}`;
    this.logger.log(`${tag} — starting`);
    const started = Date.now();
    try {
      const result = await fn();
      const stat = statKey ? report.collections[statKey] : undefined;
      this.logger.log(
        `${tag} — done in ${formatMs(Date.now() - started)}` +
          (stat ? ` — ${summarizeStat(stat)}` : ''),
      );
      return result;
    } catch (err) {
      /*
       * Name the stage on the way past, then rethrow untouched. The error
       * itself says what broke but not where in a 21-stage run, and "where" is
       * the first thing an operator needs in order to resume.
       */
      this.logger.error(
        `${tag} — FAILED after ${formatMs(Date.now() - started)}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Record a row that failed to write, and say so while the run is still going.
   *
   * These used to accumulate silently and surface only in the closing report,
   * so a run that died later lost every one of them — and a run that succeeded
   * gave no clue *when* the bad rows went past. Capped at
   * {@link ERROR_LOG_LIMIT} lines: the JSON report keeps the full list.
   */
  private recordError(report: MigrationReport, message: string): void {
    report.errors.push(message);
    if (this.loggedErrors < ERROR_LOG_LIMIT) {
      this.loggedErrors++;
      this.logger.warn(`row failed: ${message}`);
      if (this.loggedErrors === ERROR_LOG_LIMIT) {
        this.logger.warn(
          '… further row failures will not be logged (see the JSON report).',
        );
      }
    }
  }

  /** Closing tally, so the log file ends with the numbers without the report. */
  private logSummary(report: MigrationReport, completed: boolean): void {
    const collections = Object.entries(report.collections);
    const migrated = collections.reduce((sum, [, s]) => sum + s.migrated, 0);
    const skipped = collections.reduce((sum, [, s]) => sum + s.skipped, 0);
    const outcome = completed
      ? 'Migration finished'
      : `Migration ABORTED at stage ${this.stepIndex}/${MIGRATION_STEP_COUNT}, after`;
    this.logger.log(
      `${outcome} ${formatMs(report.durationMs ?? 0)} — ` +
        `${migrated} rows written across ${collections.length} collections, ` +
        `${skipped} skipped, ${report.derived.activities} activities and ` +
        `${report.derived.producerGoals} goals derived, ` +
        `${report.errors.length} errors`,
    );
    if (report.errors.length) {
      // The report prints these too, but only on a run that reaches the end.
      this.logger.warn(
        `${report.errors.length} row(s) failed to write; first ${Math.min(
          report.errors.length,
          ERROR_LOG_LIMIT,
        )} are logged above and all are in the JSON report.`,
      );
    }
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
            // A random, unusable secret — not a bcrypt hash, so `bcrypt.compare`
            // can never match it and a migrated row is never loggable into.
            // Roles are NOT assigned here: SmartSuite's role field does not map
            // onto this system's roles, and guessing would hand people access
            // nobody chose. An owner assigns them from /settings/users; the
            // first owner comes from the core seed.
            passwordHash: randomBytes(24).toString('hex'),
          },
          ctx.dryRun,
        );
        map.set(legacyId, { userId, name, monthlyGoal });
        stat.migrated += ctx.dryRun ? 0 : 1;
      } catch (err) {
        stat.skipped++;
        this.recordError(
          report,
          `user ${legacyId} (${email}): ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Users: fetched ${stat.fetched}, mapped ${map.size} producers`,
    );
    return map;
  }

  /**
   * Resolve a SmartSuite producer link to one of our users.
   *
   * Accounts for the outcome three ways (PAC-80), because "no producer" has two
   * very different causes and only one of them is a bug we could fix:
   *
   * - `linked` — resolved.
   * - `unresolved` — the source names a producer we did not import. A real
   *   defect, and the only one worth chasing.
   * - `absent` — the source record has no producer at all. **This used to return
   *   silently**, which is why 441 of 1,652 migrated deals had no `producerId`
   *   and the report still read `Unmapped: 0`. They are unattributed in
   *   SmartSuite, so there is nothing to repair — but an unattributed quarter of
   *   the book is a fact the operator should be told, not one they should have
   *   to discover by querying Mongo.
   *
   * The distinction matters downstream: an unattributed deal counts toward
   * agency-scoped scorecards and the leaderboard's office total, but toward no
   * producer's own card and no ranked row — so the office total will legitimately
   * exceed the sum of the rows.
   */
  private resolveProducer(
    legacyProducerId: string | undefined,
    producers: Map<string, ProducerEntry>,
    stat: CollectionStat,
    report: MigrationReport,
  ): ProducerEntry | undefined {
    const links = (stat.producerLinks ??= {
      linked: 0,
      unresolved: 0,
      absent: 0,
    });

    if (!legacyProducerId) {
      links.absent++;
      return undefined;
    }

    const entry = producers.get(legacyProducerId);
    if (!entry) {
      links.unresolved++;
      if (!report.producers.unmapped.includes(legacyProducerId)) {
        report.producers.unmapped.push(legacyProducerId);
      }
      return undefined;
    }

    links.linked++;
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
          status: normalizeHouseholdStatus(
            selectCode(rec[HOUSEHOLD_FIELDS.status]),
          ),
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
          roleInHousehold: normalizeContactRole(
            selectCode(rec[CONTACT_FIELDS.roleInHousehold]),
          ),
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
        stat,
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
   * reporting.
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
        stat,
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

      /*
       * Normalized to canonical labels (PAC-39). This field historically stored
       * raw SmartSuite choice codes while `deals.policyTypes` and the demo seed
       * stored labels; because `persist` `$set`s the field, a re-run heals the
       * code-holding documents already in Mongo.
       *
       * Hoisted out of the document literal because `itemCount` is bounded by
       * its length (PAC-80).
       */
      const productsQuoted = this.selectCodes(
        rec[QUOTE_RECAP_FIELDS.productsQuoted],
      ).map(normalizePolicyType);

      const id = await this.persist(
        this.quoteRecapModel,
        ctx,
        legacyId,
        {
          title: toText(rec.title),
          quoteDate,
          // The Quoted scorecard's bucket key (PAC-10). Written on import, so
          // a migrated agency needs no follow-up pass — recaps written before
          // PAC-9 are invisible to every range query until a re-run heals them.
          quoteDateYmd: quoteDate ? quoteDateYmd(quoteDate) : undefined,
          premium: toNumber(rec[QUOTE_RECAP_FIELDS.premium]),
          /*
           * Bounded by how many products the recap actually quotes — one recap
           * holds `itemCount: 3228`, which is its own *premium* (3228.98) typed
           * into the items field.
           */
          itemCount: this.plausibleItemCount(
            rec[QUOTE_RECAP_FIELDS.items],
            productsQuoted.length,
            legacyId,
            'itemCount',
            stat,
          ),
          productsQuoted,
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
   * Resolves `leadId`, `householdId` and `quoteRecapId` at import time. These
   * used to be left as `legacy*` strings for a follow-up pass to repair, which
   * meant a migrated deal had no traversable link to its lead or household —
   * audit generation and CRM assignment both resolve the client through
   * `householdId`, and the hand-off board showed "Unknown Client" without it.
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
        stat,
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

      /*
       * Read before `itemCount`, which is bounded *by* it — a 2-policy bundle
       * cannot hold 662 items.
       *
       * Bounded itself, and this ordering matters: the policy count is the item
       * count's structural denominator, so a nonsense one would *widen* the
       * ceiling instead of narrowing it and let the very values we are rejecting
       * back through.
       */
      const rawPolicyCount = toNumber(rec[DEAL_FIELDS.policyCount]);
      const policyCount = isPlausiblePolicyCount(rawPolicyCount)
        ? rawPolicyCount
        : this.rejectPolicyCount(rawPolicyCount, legacyId, stat);

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
          itemCount: this.plausibleItemCount(
            rec[DEAL_FIELDS.totalItems],
            policyCount,
            legacyId,
            'itemCount',
            stat,
          ),
          policyCount,
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
          /*
           * Derived, never imported.
           *
           * Legacy `Days Open` (`s939cb7bec`) is
           * `DATEDIFF(completion-or-today, sold_date)` — operands reversed in
           * SmartSuite itself, so it evaluates to `sold − completion` and every
           * migrated row imported a *negative* (−171, −176, −198…). Worse, it
           * measures distance from the **sold date**, not from when the item was
           * raised, which is what the board means by "open".
           *
           * `daysSince(firstCreatedAt)` is the same quantity
           * `DealAuditsService.loadChecklists` recomputes on read and
           * `AuditGenerationService.buildItem` writes at creation, so a migrated
           * item and an app-created one now agree.
           */
          daysOpen: daysSince(firstCreatedAt),
          firstCreatedAt,
          /*
           * The same 7-day rule an app-generated item gets, measured from when
           * the item was actually raised (PAC-80).
           *
           * Without this the board's Overdue / Due Soon filters answer *nothing*
           * on an imported agency: `dealAudits.dueAt` is a `$min` over open
           * items' `dueAt`, so a null on every item leaves a null on every audit,
           * and both filters exclude a missing `dueAt` by design.
           *
           * ⚠ This deliberately reverses the "no backfill" note that used to sit
           * on `DealAuditItem.dueAt`. That note was about not retro-stamping
           * documents *already in Mongo*, where a manufactured backlog would be
           * an invention. Importing a legacy row is a different act: these items
           * genuinely were raised years ago and genuinely are still open, so
           * "overdue" is the truth about them, and a hand-off board that reports
           * a real backlog is doing its job. Expect the imported set to land
           * overdue on day one — that is the finding, not a bug.
           *
           * Undefined when `firstCreatedAt` is missing, rather than dated from
           * the migration run: a deadline measured from when we happened to
           * import is not a fact about the item.
           */
          dueAt: firstCreatedAt ? auditItemDueAt(firstCreatedAt) : undefined,
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

      const policyNumber = toText(rec[POLICY_FIELDS.policyNumber]);

      const id = await this.persist(
        this.policyModel,
        ctx,
        legacyId,
        {
          policyNumber,
          // The normalized match key behind `GET /policies/check` (PAC-40).
          // Written here rather than by a follow-up pass: without it the dedupe
          // check silently matches nothing for every migrated policy, which is
          // worse than having no check — a producer is told a number is free
          // when it is not. `null` for anything under
          // MIN_POLICY_NUMBER_KEY_LENGTH usable characters, because a match on
          // two or three digits carries no information.
          policyNumberKey: normalizePolicyNumber(policyNumber),
          policyType: normalizePolicyType(
            selectCode(rec[POLICY_FIELDS.policyType]),
          ),
          // Mapped at write as well as normalized on read (PAC-56 #19): the raw
          // `B4tEH` was being rendered to users, and mapping only on read would
          // leave the stored value un-matchable against the carrier catalog.
          carrier: normalizeCarrier(selectCode(rec[POLICY_FIELDS.carrier])),
          active: toBool(rec[POLICY_FIELDS.active]),
          effectiveDate: toDate(rec[POLICY_FIELDS.effectiveDate]),
          expirationDate: toDate(rec[POLICY_FIELDS.expirationDate]),
          renewalDate: toDate(rec[POLICY_FIELDS.renewalDate]),
          premium: toNumber(rec[POLICY_FIELDS.premium]),
          /*
           * The leaf where the junk actually lives (PAC-80).
           *
           * `Deals.Total Items` is a *rollup* over the policies' `Items`, so
           * validating only the deal would leave the source of `875,244,687`
           * intact — and that policy is rendered directly on the household card
           * via `clients.service.ts`. Confirmed in the migrated data: one policy
           * has `items: 875244684` and `policyNumber: '875244684'`, the number
           * typed into the wrong field.
           *
           * A policy *is* one policy, so the bound is a single policy's ceiling.
           */
          items: this.plausibleItemCount(
            rec[POLICY_FIELDS.items],
            1,
            legacyId,
            'items',
            stat,
          ),
          policyStatus: normalizePolicyStatus(
            selectCode(rec[POLICY_FIELDS.policyStatus]),
          ),
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
          /*
           * Legacy `Result` is a `Pass`/`Fail` single-select — a strict subset
           * of the four workflow states — so it folds straight into
           * `auditStatus` (PAC-72). A row with no verdict has not been through
           * review, which is `Not Submitted`, not `Pending`.
           *
           * The `result` field is gone: two fields answering the same question
           * is how they drift.
           */
          auditStatus: normalizeDealAuditStatus(
            selectCode(rec[DEAL_AUDIT_FIELDS.result]),
          ),
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

  /**
   * Link items to roll-ups, default the assignee, and compute the board's
   * counters (PAC-72). See {@link reconcileDealAudits} for why each is needed.
   *
   * Derived entirely from data already in Mongo, so it is skipped on a dry run
   * — there is nothing imported for it to reconcile.
   */
  private async reconcileAudits(ctx: TenantCtx): Promise<void> {
    if (ctx.dryRun) {
      this.logger.log('Deal audits: reconcile skipped (dry run)');
      return;
    }

    const outcome = await reconcileDealAudits(
      {
        itemModel: this.dealAuditItemModel,
        dealAuditModel: this.dealAuditModel,
        dealModel: this.dealModel,
      },
      ctx.agencyId,
    );

    this.logger.log(
      `Deal audits: ${outcome.auditsCreated} roll-ups created, ` +
        `${outcome.itemsLinked} items linked, ${outcome.assigneesSet} assignees set, ` +
        `${outcome.statusesHealed} statuses healed, ` +
        `${outcome.countersSynced} counter sets synced`,
    );
  }

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
          /*
           * Its own vocabulary, not the prior-*policy* one, despite sharing
           * field id `sb3cc60eb5` and the codes `XT6s7`/`fr4Ge` with it. Here
           * they mean SFA Call / Customer Call; there they mean Auto / Home.
           */
          cancellationResponsibility: normalizeCancellationResponsibility(
            selectCode(rec[PRIOR_INSURANCE_FIELDS.cancellationResponsibility]),
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
          cancellationStatus: normalizePriorPolicyCancellationStatus(
            selectCode(rec[PRIOR_POLICY_FIELDS.status]),
          ),
          /*
           * Prior policies use their OWN type vocabulary, never
           * `normalizePolicyType`. Its codes (`XT6s7`/`fr4Ge`) collide with
           * the Prior Insurance table's cancellation-responsibility codes,
           * so a shared map would render one as the other.
           */
          policyType: normalizePriorPolicyType(
            selectCode(rec[PRIOR_POLICY_FIELDS.policyType]),
          ),
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
          category: normalizeLegacyTicketCategory(
            selectCode(rec[SERVICE_TICKET_FIELDS.category]),
          ),
          priority: selectCode(rec[SERVICE_TICKET_FIELDS.priority]),
          dueDate: toDate(rec[SERVICE_TICKET_FIELDS.dueDate]),
          status: normalizeLegacyTicketStatus(
            selectCode(rec[SERVICE_TICKET_FIELDS.status]),
          ),
          dateResolved: toDate(rec[SERVICE_TICKET_FIELDS.dateResolved]),
          /*
           * Unlike the deal-audit-item formula, this one is the right way round
           * (`DATEDIFF(first_created, TODAY())`, example `"65"`), so the source
           * value is trusted — but clamped, because a future `first_created`
           * would still yield a negative, and "open for −3 days" is not a thing.
           */
          daysOpen:
            Math.max(0, toNumber(rec[SERVICE_TICKET_FIELDS.daysOpen])) ||
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
          requestType: normalizeTimeOffRequestType(
            selectCode(rec[TIME_OFF_REQUEST_FIELDS.requestType]),
          ),
          hoursRequested: toNumber(rec[TIME_OFF_REQUEST_FIELDS.hoursRequested]),
          status: normalizeTimeOffStatus(
            selectCode(rec[TIME_OFF_REQUEST_FIELDS.status]),
          ),
          type: normalizeTimeOffType(
            selectCode(rec[TIME_OFF_REQUEST_FIELDS.type]),
          ),
          decision: normalizeTimeOffDecision(
            selectCode(rec[TIME_OFF_REQUEST_FIELDS.decision]),
          ),
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
    /*
     * Chicago, not UTC (PAC-80).
     *
     * `new Date().toISOString().slice(0, 7)` disagrees with the
     * `currentChicagoMonth()` the leaderboard queries with for the first five or
     * six hours of every month, so a migration run just after midnight UTC on
     * the 1st wrote goals into a month nothing would ask for.
     */
    const months = recentChicagoMonths(GOAL_MONTHS_WRITTEN);
    const withoutGoal: string[] = [];
    let created = 0;

    for (const [legacyId, entry] of producers) {
      if (entry.monthlyGoal <= 0) {
        withoutGoal.push(entry.name);
        continue;
      }
      /*
       * One row per month in the window, not just the current one.
       *
       * SmartSuite's "Monthly Goal" is a single standing scalar with no month
       * dimension, so writing it for one month made every other month
       * unanswerable — `?month=2026-07` returned no goals at all, and the
       * current month's rows silently stopped applying the moment the month
       * rolled over.
       */
      for (const month of months) {
        if (ctx.dryRun) continue;
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
              source: GOAL_SOURCE,
            },
          },
          { upsert: true },
        );
        created++;
      }
    }

    report.derived.producerGoals = created;
    report.derived.producersWithoutGoal = withoutGoal;

    /*
     * Say *why* when the answer is zero.
     *
     * "Producer goals: 0 for 2026-08" reads as a bug in the migration. It is
     * not: SmartSuite's Monthly Goal is empty for every user in this workspace,
     * so there is nothing to import and the Motivation Hub has no percentages to
     * show. That is a data-entry fact somebody can act on, and it is worth one
     * line of output to make it actionable rather than mysterious.
     */
    this.logger.log(
      created > 0
        ? `Producer goals: ${created} rows across ${months.length} months`
        : `Producer goals: 0 rows — ${withoutGoal.length} of ${producers.size} users have Monthly Goal = 0 in SmartSuite, so "% to goal" will be blank`,
    );
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
        userId: lead.producerId,
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
        userId: quote.producerId,
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
        userId: deal.producerId,
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
   * An item count the source record could not honestly have held (PAC-80).
   *
   * Legacy "items" fields contain typos of a different order to the usual
   * missing-value problem: one deal holds `875244687`, which is the policy
   * number of one of its own policies. `PerformanceService` sums this field, so
   * a single such row set the Producer Dashboard's entire Sold card.
   *
   * Rejected values fall back to a **derived** count rather than to zero, so the
   * row keeps a defensible number: a deal with 2 policies reads as 2 items, not
   * as 0. Zero is only used when there is nothing to derive from.
   *
   * ⚠ Returns a number, never `undefined`. Mongoose strips `undefined` from a
   * `$set`, so an `undefined` here would be a silent no-op — and the 875-million
   * value already in Mongo would survive the very re-run meant to heal it.
   */
  private plausibleItemCount(
    raw: unknown,
    policyCount: number | undefined,
    legacyId: string,
    field: string,
    stat: CollectionStat,
  ): number {
    const value = toNumber(raw);
    if (isPlausibleItemCount(value, policyCount)) return value;

    const replacedWith = policyCount && policyCount > 0 ? policyCount : 0;
    recordRejection(stat, {
      legacyId,
      field,
      value,
      limit: maxPlausibleItemCount(policyCount),
      replacedWith,
    });
    return replacedWith;
  }

  /** {@link plausibleItemCount}'s counterpart for the policy count itself. */
  private rejectPolicyCount(
    value: number,
    legacyId: string,
    stat: CollectionStat,
  ): number {
    recordRejection(stat, {
      legacyId,
      field: 'policyCount',
      value,
      limit: MAX_POLICIES_PER_RECORD,
      replacedWith: 0,
    });
    return 0;
  }

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
      this.recordError(
        report,
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
