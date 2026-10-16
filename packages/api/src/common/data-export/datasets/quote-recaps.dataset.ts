import {
  normalizeInsuranceMonth,
  normalizeLeadStatus,
  normalizePolicyType,
} from '@sfa/shared';
import type { Types } from 'mongoose';
import { QuoteRecap } from '../../../quote-recaps/schemas/quote-recap.schema';
import {
  resolveQuoteConversions,
  type QuoteConversion,
} from '../../sales-metrics/quote-conversion';
import { businessDaysDiff } from '../../dates/business-dates';
import { agencyCalendarDate } from '../engine/cells';
import { defineDataset } from '../engine/dataset.types';
import type { AddressLike, DealLite } from '../engine/lookups';
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

interface QuoteRecapRow extends TenantFields {
  title?: string;
  quoteRecapAutoNumber?: number;
  quoteDate?: Date;
  premium?: number;
  itemCount?: number;
  productsQuoted?: string[];
  recapStatus?: string;
  insuranceRenewalMonth?: string;
  producerId?: Types.ObjectId;
  leadId?: Types.ObjectId;
  householdId?: Types.ObjectId;
  policies?: { policyType?: string; premium?: number; itemCount?: number }[];
  propertyAddress?: AddressLike;
  sameAsHousehold?: boolean;
  notes?: string;
  quoteDocument?: { filename?: string; uploadedAt?: Date };
  legacyProducerId?: string;
  legacyLeadId?: string;
  legacyHouseholdId?: string;
  /** Added by `sourceStages(false)`: the lead's source. */
  sourceId?: Types.ObjectId | null;
}

interface QuoteRecapJoins {
  conversions: Map<string, QuoteConversion<DealLite>>;
}

const col = columnsFor<QuoteRecapRow, QuoteRecapJoins>();

/**
 * The deal a quote turned into, by the one rule the Owner dashboard also uses
 * (`common/sales-metrics/quote-conversion.ts`): the deal naming this recap,
 * else the lead's new-business sale on or after the quote day — one sale to
 * one quote, the latest quote before it.
 */
const conversionOf = (row: QuoteRecapRow, joins: QuoteRecapJoins) =>
  joins.conversions.get(String(row._id));

/** Quote recaps (SmartSuite *Quote Recaps*), with quote-to-sold conversion. */
export const quoteRecapsDataset = defineDataset<QuoteRecapRow, QuoteRecapJoins>(
  {
    key: 'quote_recaps',
    label: 'Quote recaps',
    description:
      'One row per quote: products, premium, producer, household, the lead it came from, and the deal it converted into.',
    model: QuoteRecap.name,
    scope: 'producer',
    dateFields: [
      {
        key: 'quote_date',
        label: 'Quote date',
        path: 'quoteDate',
        kind: 'instant',
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
    policyTypePath: 'productsQuoted',
    leadSource: { kind: 'viaLead', ownFallback: false },

    async joins(rows, { lookups, timeZone }) {
      await primeTenant(
        lookups,
        rows,
        rows.map((row) => row.producerId),
      );
      await Promise.all([
        lookups.households.load(rows.map((row) => row.householdId)),
        lookups.leads.load(rows.map((row) => row.leadId)),
      ]);
      await lookups.contacts.load(
        rows.map(
          (row) => lookups.households.get(row.householdId)?.primaryContactId,
        ),
      );
      const leadIds = rows.map((row) => row.leadId);
      const [byRecap, byLead, siblings] = await Promise.all([
        lookups.dealsBy(
          'quoteRecapId',
          rows.map((row) => row._id),
        ),
        lookups.dealsBy('leadId', leadIds),
        lookups.quotesByLead(leadIds),
      ]);
      return {
        conversions: resolveQuoteConversions(
          rows,
          { byRecap, byLead, siblings },
          timeZone,
        ),
      };
    },

    columns: [
      col('quote_recap_id', 'id', 'Quote recap record id.', (row) => row._id),
      col(
        'quote_recap_number',
        'number',
        'Quote Recap ID (auto number).',
        (row) => row.quoteRecapAutoNumber,
      ),
      col('title', 'string', 'Record title.', (row) => row.title),
      col(
        'quote_date',
        'date',
        "Quote date, on the agency's calendar.",
        (row, ctx) => agencyCalendarDate(row.quoteDate, ctx.timeZone),
      ),
      col(
        'quote_at',
        'datetime',
        'Quote date as stored (UTC).',
        (row) => row.quoteDate,
      ),
      col('recap_status', 'string', 'Recap status.', (row) => row.recapStatus),
      col('premium', 'number', 'Total quoted premium.', (row) => row.premium),
      col(
        'item_count',
        'number',
        'Total quoted items.',
        (row) => row.itemCount,
      ),
      col('products_quoted', 'list', 'Lines of business quoted.', (row) =>
        (row.productsQuoted ?? []).map((value) => normalizePolicyType(value)),
      ),
      col(
        'products_quoted_raw',
        'list',
        'Products exactly as stored; migrated rows hold SmartSuite codes.',
        (row) => row.productsQuoted,
      ),
      col(
        'quoted_line_count',
        'number',
        'Per-line quotes recorded (empty on migrated recaps).',
        (row) => row.policies?.length ?? 0,
      ),
      col(
        'quoted_lines',
        'list',
        'Per-line quotes as "type premium/items".',
        (row) =>
          (row.policies ?? []).map(
            (line) =>
              `${normalizePolicyType(line.policyType)} ${line.premium ?? 0}/${line.itemCount ?? 0}`,
          ),
      ),
      col(
        'insurance_renewal_month',
        'string',
        "Month the client's current insurance renews.",
        (row) =>
          row.insuranceRenewalMonth
            ? normalizeInsuranceMonth(row.insuranceRenewalMonth)
            : null,
      ),
      ...userColumns<QuoteRecapRow>(
        'producer',
        'Producer who quoted',
        (row) => row.producerId,
      ),
      col(
        'lead_id',
        'id',
        'Lead the quote was recorded against.',
        (row) => row.leadId,
      ),
      col(
        'lead_status',
        'string',
        'That lead’s current status.',
        (row, ctx) => {
          const status = ctx.lookups.leads.get(row.leadId)?.status;
          return status ? normalizeLeadStatus(status) : null;
        },
      ),
      ...leadSourceColumns<QuoteRecapRow>(
        (row) => row.sourceId,
        "The lead's source",
      ),
      ...householdColumns<QuoteRecapRow>((row) => row.householdId),
      ...contactColumns<QuoteRecapRow>(
        'primary_contact',
        "Household's primary contact",
        (row, ctx) =>
          ctx.lookups.households.get(row.householdId)?.primaryContactId,
      ),
      ...addressColumns<QuoteRecapRow>(
        'property',
        'Quoted property address',
        (row) => row.propertyAddress,
      ),
      col(
        'property_same_as_household',
        'boolean',
        'Property address is the household address.',
        (row) => row.sameAsHousehold,
      ),
      col(
        'converted',
        'boolean',
        'Whether the quote turned into a new-business sale (company transfers do not count).',
        (row, ctx) => Boolean(conversionOf(row, ctx.joins)),
      ),
      col(
        'converted_matched_by',
        'string',
        'quote_recap when the deal names this recap; lead when inferred as the lead’s sale on or after the quote date (a requoted lead’s sale goes to the latest quote before it).',
        (row, ctx) => conversionOf(row, ctx.joins)?.matchedBy,
      ),
      col(
        'converted_deal_id',
        'id',
        'The deal it converted into.',
        (row, ctx) => conversionOf(row, ctx.joins)?.deal._id,
      ),
      col(
        'converted_sold_date',
        'date',
        'Sold date of that deal.',
        (row, ctx) =>
          agencyCalendarDate(
            conversionOf(row, ctx.joins)?.deal.soldDate,
            ctx.timeZone,
          ),
      ),
      col(
        'converted_premium',
        'number',
        'Sold premium of that deal.',
        (row, ctx) => conversionOf(row, ctx.joins)?.deal.premium,
      ),
      col('days_to_close', 'number', 'Days from quote to sale.', (row, ctx) => {
        const sold = conversionOf(row, ctx.joins)?.deal.soldDate;
        return row.quoteDate && sold
          ? businessDaysDiff(row.quoteDate, sold, ctx.timeZone)
          : null;
      }),
      col(
        'quote_document_filename',
        'string',
        'Name of the attached quote document.',
        (row) => row.quoteDocument?.filename,
      ),
      col(
        'quote_document_uploaded_at',
        'datetime',
        'When it was uploaded (UTC).',
        (row) => row.quoteDocument?.uploadedAt,
      ),
      col('notes', 'string', 'Quote notes.', (row) => row.notes),
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
      ...tenantColumns<QuoteRecapRow>(),
    ],
  },
);
