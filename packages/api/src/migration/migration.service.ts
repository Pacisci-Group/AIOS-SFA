import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Agency } from '../platform/schemas/agency.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { User } from '../users/schemas/user.schema';
import { Household } from '../households/schemas/household.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { QuoteRecap } from '../quote-recaps/schemas/quote-recap.schema';
import { Deal } from '../deals/schemas/deal.schema';
import { AuditRecord } from '../audit-records/schemas/audit-record.schema';
import { Activity } from '../activities/schemas/activity.schema';
import { ProducerGoal } from '../producer-goals/schemas/producer-goal.schema';
import {
  SmartSuiteClient,
  loadSmartSuiteConfig,
} from './smartsuite/smartsuite.client';
import { SMARTSUITE_TABLE_IDS } from './smartsuite/table-ids';
import {
  DEAL_AUDIT_CATEGORY_LABELS,
  DEAL_AUDIT_ITEM_FIELDS,
  DEAL_AUDIT_ITEM_NAME_LABELS,
  DEAL_AUDIT_STATUS_LABELS,
  DEAL_AUDIT_UPDATE_STATUS_LABELS,
  DEAL_FIELDS,
  HOUSEHOLD_FIELDS,
  LEAD_FIELDS,
  QUOTE_RECAP_FIELDS,
  USER_FIELDS,
} from './smartsuite/field-ids';
import {
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
import { isTestRecord, normalizeLeadSource } from './helpers/lead-sources';
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
  legacyId: string;
  producerId?: Types.ObjectId;
  occurredAt?: Date;
  isTest: boolean;
}

interface DealRef {
  dealId: Types.ObjectId;
  legacyId: string;
  producerId?: Types.ObjectId;
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
    @InjectModel(AuditRecord.name)
    private readonly auditRecordModel: Model<AuditRecord>,
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(ProducerGoal.name)
    private readonly producerGoalModel: Model<ProducerGoal>,
  ) {}

  async run(options: MigrationOptions): Promise<MigrationReport> {
    const report = createReport(options.dryRun);
    const started = Date.now();
    const ss = new SmartSuiteClient(loadSmartSuiteConfig());

    const ctx = await this.resolveTenant(options, report);

    const producers = await this.migrateUsers(ss, ctx, options, report);
    report.producers.mapped = producers.size;

    await this.migrateHouseholds(ss, ctx, producers, options, report);
    const leads = await this.migrateLeads(ss, ctx, producers, options, report);
    const quotes = await this.migrateQuoteRecaps(
      ss,
      ctx,
      producers,
      options,
      report,
    );
    const deals = await this.migrateDeals(ss, ctx, producers, options, report);
    await this.migrateAuditItems(ss, ctx, deals, options, report);

    await this.deriveProducerGoals(ctx, producers, report);
    await this.deriveActivities(ctx, leads, quotes, deals, report);

    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - started;
    return report;
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
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.households = stat;

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

      const legacyCrmId = firstLinkedId(rec[HOUSEHOLD_FIELDS.assignedCrm]);
      const crm = legacyCrmId ? producers.get(legacyCrmId) : undefined;

      await this.persist(
        this.householdModel,
        ctx,
        legacyId,
        {
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
    }
    this.logger.log(`Households: fetched ${stat.fetched}`);
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

  private async migrateQuoteRecaps(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<QuoteRef[]> {
    const stat = emptyStat();
    report.collections.quoteRecaps = stat;
    const refs: QuoteRef[] = [];

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

      const id = await this.persist(
        this.quoteRecapModel,
        ctx,
        legacyId,
        {
          title: toText(rec.title),
          quoteDate,
          premium: toNumber(rec[QUOTE_RECAP_FIELDS.premium]),
          itemCount: toNumber(rec[QUOTE_RECAP_FIELDS.items]),
          productsQuoted: this.selectCodes(
            rec[QUOTE_RECAP_FIELDS.productsQuoted],
          ),
          recapStatus: selectCode(rec[QUOTE_RECAP_FIELDS.recapStatus]),
          producerId: producer?.userId,
          legacyProducerId: firstLinkedId(rec[QUOTE_RECAP_FIELDS.producer]),
          legacyLeadId: firstLinkedId(rec[QUOTE_RECAP_FIELDS.lead]),
          legacyHouseholdId: firstLinkedId(rec[QUOTE_RECAP_FIELDS.household]),
          isTestRecord: test,
        },
        stat,
        report,
      );

      if (id) {
        refs.push({
          legacyId,
          producerId: producer?.userId,
          occurredAt: quoteDate,
          isTest: test,
        });
      }
    }
    this.logger.log(`Quote Recaps: fetched ${stat.fetched}`);
    return refs;
  }

  // ---------------------------------------------------------------------------
  // Deals (Sold Log)
  // ---------------------------------------------------------------------------

  private async migrateDeals(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    producers: Map<string, ProducerEntry>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<Map<string, DealRef>> {
    const stat = emptyStat();
    report.collections.deals = stat;
    const map = new Map<string, DealRef>();

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
          legacyLeadId: firstLinkedId(rec[DEAL_FIELDS.lead]),
          legacyHouseholdId: firstLinkedId(rec[DEAL_FIELDS.household]),
          legacyQuoteRecapId: firstLinkedId(rec[DEAL_FIELDS.quoteRecap]),
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
          occurredAt: soldDate,
          clientName,
          isTest: test,
        });
      }
    }
    this.logger.log(`Deals: fetched ${stat.fetched}`);
    return map;
  }

  // ---------------------------------------------------------------------------
  // Deal Audit Items -> auditRecords
  // ---------------------------------------------------------------------------

  private async migrateAuditItems(
    ss: SmartSuiteClient,
    ctx: TenantCtx,
    deals: Map<string, DealRef>,
    options: MigrationOptions,
    report: MigrationReport,
  ): Promise<void> {
    const stat = emptyStat();
    report.collections.auditRecords = stat;

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
        this.auditRecordModel,
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
