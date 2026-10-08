import {
  LEAD_STATUSES,
  leadStatusQueryValues,
  normalizeLeadStatus,
  normalizePolicyType,
} from '@sfa/shared';
import type { Types } from 'mongoose';
import { Lead } from '../../../leads/schemas/lead.schema';
import { agencyCalendarDate, ymdDate } from '../engine/cells';
import { defineDataset } from '../engine/dataset.types';
import type { AddressLike, DealLite, QuoteLite } from '../engine/lookups';
import {
  addressColumns,
  columnsFor,
  contactColumns,
  householdColumns,
  leadSourceColumns,
  primeTenant,
  tenantColumns,
  type TenantFields,
  userColumns,
} from './columns';

interface LeadRow extends TenantFields {
  firstName?: string;
  lastName?: string;
  status?: string;
  temperature?: string;
  leadSourceId?: Types.ObjectId;
  createdDate?: Date;
  lastActivityAt?: Date;
  quoteControlNumber?: string;
  producerId?: Types.ObjectId;
  householdId?: Types.ObjectId;
  primaryContactId?: Types.ObjectId;
  memberContactIds?: Types.ObjectId[];
  policiesOfInterest?: { policyType?: string; itemCount?: number }[];
  address?: AddressLike;
  propertyAddress?: AddressLike;
  mailer?: {
    mailerId?: Types.ObjectId | null;
    campaignId?: string | null;
    matchedBy?: string;
    linkedAt?: Date;
  };
  intakeSource?: { channel?: string; submittedAt?: Date };
  replacementIntent?: {
    policyId?: Types.ObjectId;
    reason?: string;
    consumedAt?: Date | null;
    consumedByDealId?: Types.ObjectId | null;
  };
  legacyProducerId?: string;
  legacyHouseholdId?: string;
}

interface LeadJoins {
  quotes: Map<string, QuoteLite[]>;
  deals: Map<string, DealLite[]>;
}

const col = columnsFor<LeadRow, LeadJoins>();

const quotesOf = (row: LeadRow, joins: LeadJoins) =>
  joins.quotes.get(String(row._id)) ?? [];
const latestQuote = (row: LeadRow, joins: LeadJoins) =>
  quotesOf(row, joins).at(-1);
const dealsOf = (row: LeadRow, joins: LeadJoins) =>
  joins.deals.get(String(row._id)) ?? [];
const firstDeal = (row: LeadRow, joins: LeadJoins) => dealsOf(row, joins)[0];

/**
 * Leads (SmartSuite *Leads*). One row per lead, with its contact details
 * resolved through the primary contact (the lead no longer copies them) and
 * its outcome rolled up: was it quoted, was it sold.
 */
export const leadsDataset = defineDataset<LeadRow, LeadJoins>({
  key: 'leads',
  label: 'Leads',
  description:
    'One row per lead: contact details, source, producer, household, and whether it was quoted and sold.',
  model: Lead.name,
  scope: 'producer',
  dateFields: [
    {
      key: 'created',
      label: 'Created date',
      path: 'createdDate',
      kind: 'leadCreated',
      isDefault: true,
    },
    {
      key: 'last_activity',
      label: 'Last activity',
      path: 'lastActivityAt',
      kind: 'instant',
    },
  ],
  filters: [
    'branchId',
    'producerIds',
    'status',
    'leadSourceIds',
    'policyTypes',
  ],
  status: {
    values: LEAD_STATUSES,
    queryValues: leadStatusQueryValues,
    path: 'status',
  },
  policyTypePath: 'policiesOfInterest.policyType',
  leadSource: { kind: 'direct' },

  async joins(rows, { lookups }) {
    const ids = rows.map((row) => row._id);
    await primeTenant(
      lookups,
      rows,
      rows.map((row) => row.producerId),
    );
    await lookups.households.load(rows.map((row) => row.householdId));
    await lookups.contacts.load(rows.map((row) => row.primaryContactId));
    const [quotes, deals] = await Promise.all([
      lookups.quotesByLead(ids),
      lookups.dealsBy('leadId', ids),
    ]);
    return { quotes, deals };
  },

  columns: [
    col('lead_id', 'id', 'Lead record id.', (row) => row._id),
    col(
      'first_name',
      'string',
      'Lead first name as entered on the lead.',
      (row) => row.firstName,
    ),
    col(
      'last_name',
      'string',
      'Lead last name as entered on the lead.',
      (row) => row.lastName,
    ),
    col('status', 'string', 'Lead status.', (row) =>
      normalizeLeadStatus(row.status),
    ),
    col(
      'status_raw',
      'string',
      'Status exactly as stored; migrated rows may hold a SmartSuite choice code.',
      (row) => row.status,
    ),
    col(
      'temperature',
      'string',
      'Hot / Warm / Cold.',
      (row) => row.temperature,
    ),
    col(
      'created_date',
      'date',
      "Day the lead came in, on the agency's calendar — the date the dashboards count it under.",
      (row, ctx) =>
        agencyCalendarDate(row.createdDate ?? row.createdAt, ctx.timeZone),
    ),
    col(
      'created_at',
      'datetime',
      'When the lead came in (UTC).',
      (row) => row.createdDate ?? row.createdAt,
    ),
    col(
      'last_activity_at',
      'datetime',
      'Last call, text, email or note logged (UTC).',
      (row) => row.lastActivityAt,
    ),
    col(
      'quote_control_number',
      'string',
      'Mailer Quote Control Number, when the lead came from a mailer.',
      (row) => row.quoteControlNumber,
    ),
    ...leadSourceColumns<LeadRow>(
      (row) => row.leadSourceId,
      'Where the lead came from',
    ),
    ...userColumns<LeadRow>(
      'producer',
      'Producer who owns the lead',
      (row) => row.producerId,
    ),
    ...householdColumns<LeadRow>((row) => row.householdId),
    ...contactColumns<LeadRow>(
      'primary_contact',
      'Primary contact',
      (row) => row.primaryContactId,
      { dateOfBirth: true },
    ),
    col(
      'member_count',
      'number',
      'Household members recorded on the lead.',
      (row) => row.memberContactIds?.length ?? 0,
    ),
    col(
      'policies_of_interest',
      'list',
      'Lines of business the lead asked about.',
      (row) =>
        (row.policiesOfInterest ?? []).map((line) =>
          normalizePolicyType(line.policyType),
        ),
    ),
    col(
      'policies_of_interest_item_count',
      'number',
      'Vehicles / items across those lines.',
      (row) =>
        (row.policiesOfInterest ?? []).reduce(
          (sum, line) => sum + (line.itemCount ?? 0),
          0,
        ),
    ),
    ...addressColumns<LeadRow>(
      'address',
      'Lead living address',
      (row) => row.address,
    ),
    ...addressColumns<LeadRow>(
      'property',
      'Property address (legacy)',
      (row) => row.propertyAddress,
    ),
    col(
      'mailer_id',
      'id',
      'Mailer record the lead was logged from.',
      (row) => row.mailer?.mailerId,
    ),
    col(
      'mailer_campaign_id',
      'id',
      'Mail campaign the lead is attributed to.',
      (row) => row.mailer?.campaignId,
    ),
    col(
      'mailer_matched_by',
      'string',
      'How the mailer was matched: drawer, control_number or address.',
      (row) => row.mailer?.matchedBy,
    ),
    col(
      'mailer_linked_at',
      'datetime',
      'When the mailer was linked (UTC).',
      (row) => row.mailer?.linkedAt,
    ),
    col(
      'intake_channel',
      'string',
      'internal, share_link or mailer.',
      (row) => row.intakeSource?.channel,
    ),
    col(
      'intake_submitted_at',
      'datetime',
      'When a public intake form was submitted (UTC).',
      (row) => row.intakeSource?.submittedAt,
    ),
    col(
      'replacement_policy_id',
      'id',
      'Existing policy this lead was opened to replace.',
      (row) => row.replacementIntent?.policyId,
    ),
    col(
      'replacement_reason',
      'string',
      'company_transfer or cancel_rewrite.',
      (row) => row.replacementIntent?.reason,
    ),
    col(
      'replacement_consumed_at',
      'datetime',
      'When the replacement was sold (UTC).',
      (row) => row.replacementIntent?.consumedAt,
    ),
    col(
      'replacement_deal_id',
      'id',
      'Deal that consumed the replacement.',
      (row) => row.replacementIntent?.consumedByDealId,
    ),
    col(
      'quoted',
      'boolean',
      'Whether any quote recap is linked to the lead.',
      (row, ctx) => quotesOf(row, ctx.joins).length > 0,
    ),
    col(
      'quote_count',
      'number',
      'Quote recaps linked to the lead.',
      (row, ctx) => quotesOf(row, ctx.joins).length,
    ),
    col(
      'latest_quote_recap_id',
      'id',
      'Most recent quote recap.',
      (row, ctx) => latestQuote(row, ctx.joins)?._id,
    ),
    col(
      'latest_quote_date',
      'date',
      'Quote date of the most recent recap.',
      (row, ctx) => ymdDate(latestQuote(row, ctx.joins)?.quoteDateYmd),
    ),
    col(
      'latest_quote_premium',
      'number',
      'Quoted premium of the most recent recap.',
      (row, ctx) => latestQuote(row, ctx.joins)?.premium,
    ),
    col(
      'sold',
      'boolean',
      'Whether any deal is linked to the lead.',
      (row, ctx) => dealsOf(row, ctx.joins).length > 0,
    ),
    col(
      'deal_count',
      'number',
      'Deals linked to the lead.',
      (row, ctx) => dealsOf(row, ctx.joins).length,
    ),
    col(
      'first_deal_id',
      'id',
      'First deal sold from the lead.',
      (row, ctx) => firstDeal(row, ctx.joins)?._id,
    ),
    col('first_sold_date', 'date', 'Sold date of that deal.', (row, ctx) =>
      ymdDate(firstDeal(row, ctx.joins)?.soldDateYmd),
    ),
    col(
      'first_sold_premium',
      'number',
      'Premium of that deal.',
      (row, ctx) => firstDeal(row, ctx.joins)?.premium,
    ),
    col(
      'legacy_producer_id',
      'id',
      'SmartSuite producer id, kept for reconciliation.',
      (row) => row.legacyProducerId,
    ),
    col(
      'legacy_household_id',
      'id',
      'SmartSuite household id, kept for reconciliation.',
      (row) => row.legacyHouseholdId,
    ),
    ...tenantColumns<LeadRow>(),
  ],
});
