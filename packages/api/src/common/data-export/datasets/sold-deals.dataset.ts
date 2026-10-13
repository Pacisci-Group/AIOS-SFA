import {
  DEFAULT_BUSINESS_TYPE,
  normalizeCarrier,
  normalizeDealAuditStatus,
  normalizeLeadStatus,
  normalizePolicyStatus,
  normalizePolicyType,
} from '@sfa/shared';
import type { Types } from 'mongoose';
import { Deal } from '../../../deals/schemas/deal.schema';
import { fromYmd } from '../../../performance/performance.range';
import { ymdDate } from '../engine/cells';
import { defineDataset } from '../engine/dataset.types';
import type { AuditLite, ExportLookups, PolicyLite } from '../engine/lookups';
import {
  columnsFor,
  contactColumns,
  distinct,
  householdColumns,
  leadSourceColumns,
  primeTenant,
  tenantColumns,
  type TenantFields,
  userColumns,
} from './columns';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface DealRow extends TenantFields {
  title?: string;
  dealAutoNumber?: number;
  soldDate?: Date;
  soldDateYmd?: number;
  premium?: number;
  premiumSource?: string;
  chargebackAdjustment?: number;
  itemCount?: number;
  policyCount?: number;
  dealType?: string;
  businessType?: string;
  isBundle?: boolean;
  policyTypes?: string[];
  leadSourceId?: Types.ObjectId;
  clientName?: string;
  producerId?: Types.ObjectId;
  leadId?: Types.ObjectId;
  householdId?: Types.ObjectId;
  quoteRecapId?: Types.ObjectId;
  primaryContactId?: Types.ObjectId;
  assignedCrmId?: Types.ObjectId;
  crmAssignedAt?: Date;
  crmAssignmentStatus?: string;
  ticketId?: Types.ObjectId | null;
  mortgagee?: boolean;
  auditTriggers?: Partial<{
    defensiveDriver: boolean;
    goodStudent: boolean;
    drivewise: boolean;
    fireSubscription: boolean;
    actualCashValue: boolean;
    hailResistantRoof: boolean;
    priorInsurance: boolean;
    priorPolicyDeclared: boolean;
    defensiveDriverNames: string[];
  }>;
  auditGeneratedAt?: Date;
  dealAuditStatus?: string;
  status?: string;
  legacyProducerId?: string;
  legacyLeadId?: string;
  legacyHouseholdId?: string;
  legacyQuoteRecapId?: string;
  /** Added by `sourceStages(true)`: the lead's source, else the deal's own. */
  sourceId?: Types.ObjectId | null;
}

interface DealJoins {
  policies: Map<string, PolicyLite[]>;
  audits: Map<string, AuditLite>;
}

const col = columnsFor<DealRow, DealJoins>();

const policiesOf = (row: DealRow, joins: DealJoins) =>
  joins.policies.get(String(row._id)) ?? [];
const auditOf = (row: DealRow, joins: DealJoins) =>
  joins.audits.get(String(row._id));
/** The deal's own contact, else its household's — older deals carry none. */
const contactOf = (row: DealRow, lookups: ExportLookups) =>
  row.primaryContactId ??
  lookups.households.get(row.householdId)?.primaryContactId;

const TRIGGERS: [
  keyof NonNullable<DealRow['auditTriggers']>,
  string,
  string,
][] = [
  [
    'defensiveDriver',
    'trigger_defensive_driver',
    'Defensive driver discount claimed.',
  ],
  ['goodStudent', 'trigger_good_student', 'Good student discount claimed.'],
  ['drivewise', 'trigger_drivewise', 'Drivewise enrolled.'],
  [
    'fireSubscription',
    'trigger_fire_subscription',
    'Fire subscription discount claimed.',
  ],
  [
    'actualCashValue',
    'trigger_actual_cash_value',
    'Actual cash value coverage.',
  ],
  [
    'hailResistantRoof',
    'trigger_hail_resistant_roof',
    'Hail-resistant roof discount claimed.',
  ],
  [
    'priorInsurance',
    'trigger_prior_insurance',
    'Prior insurance discount claimed.',
  ],
  [
    'priorPolicyDeclared',
    'trigger_prior_policy_declared',
    'A prior policy was declared for cancellation.',
  ],
];

/**
 * Sold deals (SmartSuite *Deals (Sold Log)*). One row per sale, with the
 * lookups and rollups the Sold Log carried: producer and household names,
 * policy numbers and types, total and net premium, audit status and counts.
 */
export const soldDealsDataset = defineDataset<DealRow, DealJoins>({
  key: 'sold_deals',
  label: 'Sold deals',
  description:
    'One row per sale (the Sold Log): policies, premium and net premium, producer, household, lead source and audit status.',
  model: Deal.name,
  scope: 'producer',
  dateFields: [
    {
      key: 'sold_date',
      label: 'Sold date',
      path: 'soldDateYmd',
      kind: 'ymd',
      isDefault: true,
    },
    {
      key: 'created',
      label: 'Recorded at',
      path: 'createdAt',
      kind: 'instant',
    },
  ],
  filters: ['branchId', 'producerIds', 'leadSourceIds', 'policyTypes'],
  policyTypePath: 'policyTypes',
  leadSource: { kind: 'viaLead', ownFallback: true },

  async joins(rows, { lookups }) {
    const ids = rows.map((row) => row._id);
    await primeTenant(
      lookups,
      rows,
      rows.flatMap((row) => [row.producerId, row.assignedCrmId]),
    );
    await Promise.all([
      lookups.households.load(rows.map((row) => row.householdId)),
      lookups.leads.load(rows.map((row) => row.leadId)),
    ]);
    await lookups.contacts.load(rows.map((row) => contactOf(row, lookups)));
    const [policies, audits] = await Promise.all([
      lookups.policiesBy('dealId', ids),
      lookups.auditByDeal(ids),
    ]);
    return { policies, audits };
  },

  columns: [
    col('deal_id', 'id', 'Deal record id.', (row) => row._id),
    col(
      'deal_number',
      'number',
      'Deal ID (auto number).',
      (row) => row.dealAutoNumber,
    ),
    col('title', 'string', 'Record title.', (row) => row.title),
    col('sold_date', 'date', "Sold date, on the agency's calendar.", (row) =>
      ymdDate(row.soldDateYmd),
    ),
    col('sold_year', 'number', 'Sold year.', (row) =>
      row.soldDateYmd ? fromYmd(row.soldDateYmd).year : null,
    ),
    col('sold_month', 'number', 'Sold month, 1–12.', (row) =>
      row.soldDateYmd ? fromYmd(row.soldDateYmd).month : null,
    ),
    col('sold_month_name', 'string', 'Sold month name.', (row) =>
      row.soldDateYmd ? MONTH_NAMES[fromYmd(row.soldDateYmd).month - 1] : null,
    ),
    col(
      'sold_at',
      'datetime',
      'Sold date as stored (UTC).',
      (row) => row.soldDate,
    ),
    ...userColumns<DealRow>(
      'producer',
      'Producer who sold',
      (row) => row.producerId,
    ),
    col('lead_id', 'id', 'Lead the sale came from.', (row) => row.leadId),
    col('lead_status', 'string', 'That lead’s current status.', (row, ctx) => {
      const status = ctx.lookups.leads.get(row.leadId)?.status;
      return status ? normalizeLeadStatus(status) : null;
    }),
    ...leadSourceColumns<DealRow>(
      (row) => row.sourceId,
      "Lead source the sale is credited to — the lead's, else the deal's own",
    ),
    col(
      'deal_lead_source_id',
      'id',
      'Lead source recorded on the deal itself (the fallback), for reconciliation.',
      (row) => row.leadSourceId,
    ),
    col(
      'quote_recap_id',
      'id',
      'Quote recap the sale was linked to.',
      (row) => row.quoteRecapId,
    ),
    ...householdColumns<DealRow>((row) => row.householdId),
    col(
      'client_name',
      'string',
      'Client name.',
      (row, ctx) =>
        row.clientName ??
        ctx.lookups.contacts.get(contactOf(row, ctx.lookups))?.name,
    ),
    ...contactColumns<DealRow>(
      'primary_contact',
      'Primary contact',
      (row, ctx) => contactOf(row, ctx.lookups),
      {
        dateOfBirth: true,
      },
    ),
    ...userColumns<DealRow>(
      'assigned_crm',
      'Client relations manager assigned for onboarding',
      (row) => row.assignedCrmId,
    ),
    col(
      'crm_assigned_at',
      'datetime',
      'When the CRM was assigned (UTC).',
      (row) => row.crmAssignedAt,
    ),
    col(
      'crm_assignment_status',
      'string',
      'Outcome of CRM assignment.',
      (row) => row.crmAssignmentStatus,
    ),
    col('policy_ids', 'list', 'Policies booked on the sale.', (row, ctx) =>
      policiesOf(row, ctx.joins).map((p) => p._id),
    ),
    col('policy_numbers', 'list', 'Policy numbers.', (row, ctx) =>
      policiesOf(row, ctx.joins).map((p) => p.policyNumber),
    ),
    col('policy_types', 'list', 'Lines of business sold.', (row, ctx) => {
      const fromPolicies = distinct(
        policiesOf(row, ctx.joins).map((p) =>
          normalizePolicyType(p.policyType),
        ),
      );
      return fromPolicies.length
        ? fromPolicies
        : distinct((row.policyTypes ?? []).map((t) => normalizePolicyType(t)));
    }),
    col('policy_carriers', 'list', 'Carriers on those policies.', (row, ctx) =>
      distinct(
        policiesOf(row, ctx.joins).map((p) => normalizeCarrier(p.carrier)),
      ),
    ),
    col(
      'policy_statuses',
      'list',
      'Current status of each policy, in policy order.',
      (row, ctx) =>
        policiesOf(row, ctx.joins).map((p) =>
          p.policyStatus ? normalizePolicyStatus(p.policyStatus) : '',
        ),
    ),
    col('policy_count', 'number', 'Policies on the sale.', (row, ctx) => {
      const count = policiesOf(row, ctx.joins).length;
      return count || row.policyCount || 0;
    }),
    col('item_count', 'number', 'Total items.', (row) => row.itemCount),
    col('premium', 'number', 'Total premium.', (row) => row.premium),
    col(
      'chargeback_adjustment',
      'number',
      'Chargebacks against the sale (zero or negative).',
      (row) => row.chargebackAdjustment ?? 0,
    ),
    col(
      'net_premium',
      'number',
      'Premium after chargebacks — what the scorecards count as sold.',
      (row) => (row.premium ?? 0) + (row.chargebackAdjustment ?? 0),
    ),
    col(
      'premium_source',
      'string',
      'rollup, snapshot or none: where the premium figure came from.',
      (row) => row.premiumSource,
    ),
    col(
      'deal_type',
      'string',
      'Auto / Home / Bundle / Other.',
      (row) => row.dealType,
    ),
    col(
      'business_type',
      'string',
      'new_business or company_transfer.',
      (row) => row.businessType ?? DEFAULT_BUSINESS_TYPE,
    ),
    col('is_bundle', 'boolean', 'Bundle sale.', (row) => row.isBundle),
    col(
      'mortgagee',
      'boolean',
      'A mortgagee is involved.',
      (row) => row.mortgagee,
    ),
    col('status', 'string', 'Deal status.', (row) => row.status),
    col('deal_audit_status', 'string', 'Deal Audit Status.', (row, ctx) => {
      const status =
        auditOf(row, ctx.joins)?.auditStatus ?? row.dealAuditStatus;
      return status ? normalizeDealAuditStatus(status) : null;
    }),
    col(
      'audit_item_count',
      'number',
      'Audit items generated.',
      (row, ctx) => auditOf(row, ctx.joins)?.itemCount,
    ),
    col(
      'audit_resolved_count',
      'number',
      'Audit items resolved (passed).',
      (row, ctx) => auditOf(row, ctx.joins)?.resolvedCount,
    ),
    col(
      'audit_open_failed_count',
      'number',
      'Audit items failed and still open.',
      (row, ctx) => auditOf(row, ctx.joins)?.openFailedCount,
    ),
    col(
      'audit_due_at',
      'datetime',
      'Audit due date (UTC).',
      (row, ctx) => auditOf(row, ctx.joins)?.dueAt,
    ),
    col(
      'audit_submitted_at',
      'datetime',
      'When the producer submitted the audit (UTC).',
      (row, ctx) => auditOf(row, ctx.joins)?.submittedAt,
    ),
    col(
      'audit_generated_at',
      'datetime',
      'When the audit checklist was generated (UTC).',
      (row) => row.auditGeneratedAt,
    ),
    ...TRIGGERS.map(([field, key, description]) =>
      col(key, 'boolean', description, (row) =>
        Boolean(row.auditTriggers?.[field]),
      ),
    ),
    col(
      'trigger_defensive_driver_names',
      'list',
      'Drivers named on the defensive driver discount.',
      (row) => row.auditTriggers?.defensiveDriverNames,
    ),
    col(
      'ticket_id',
      'id',
      'Service ticket, for a policy transfer.',
      (row) => row.ticketId,
    ),
    col(
      'legacy_producer_id',
      'id',
      'SmartSuite producer id.',
      (row) => row.legacyProducerId,
    ),
    col(
      'legacy_lead_id',
      'id',
      'SmartSuite lead id.',
      (row) => row.legacyLeadId,
    ),
    col(
      'legacy_household_id',
      'id',
      'SmartSuite household id.',
      (row) => row.legacyHouseholdId,
    ),
    col(
      'legacy_quote_recap_id',
      'id',
      'SmartSuite quote recap id.',
      (row) => row.legacyQuoteRecapId,
    ),
    ...tenantColumns<DealRow>(),
  ],
});
