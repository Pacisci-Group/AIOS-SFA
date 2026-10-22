import { NEW_BUSINESS_MATCH } from '@sfa/shared';
import { type Model, Types } from 'mongoose';
import { businessDay } from '../dates/business-dates';

/**
 * Which sale a quote recap turned into — the one rule for "was this quote
 * sold?" (PAC-152 data export, then the Owner dashboard's quote figures).
 *
 * Lifted out of the quote-recaps dataset when the Owner dashboard became the
 * second reader: a quote that the export calls converted and the dashboard
 * calls open would be the same screen-share argument `HOUSEHOLD_KEY_EXPR`
 * exists to prevent. Lives in `common/` so the worker (which builds exports)
 * may import it.
 *
 * ## The rule
 *
 * 1. **A deal that names the recap** (`Deal.quoteRecapId`, written by the Sold
 *    form) is its conversion. Always wins.
 * 2. Otherwise **the lead's sale**: a new-business deal on the same lead, sold
 *    on or after the quote's agency-calendar day, that names no recap. Most
 *    migrated deals carry no `quoteRecapId` (92 of 1,699 on the Oct 2026 prod
 *    dump), so this fallback is load-bearing, and it is flagged as such
 *    (`matchedBy: 'lead'`).
 *
 * Days are compared on the agency's calendar, not as instants, so a quote and
 * a sale written on one visit match whatever their times.
 *
 * ## One deal, one quote
 *
 * A lead may be quoted more than once (a requote). Each lead-resolved deal is
 * given to **one** recap: the most recent one on or before its sold day that
 * has not already been given a deal. Without that, a requoted lead that bought
 * once would count as two sold quotes, and a producer's "sold" could exceed
 * their sales. The earlier, superseded recap then reads as unconverted.
 *
 * Arbitration needs **every** recap on the lead, not just the ones the caller
 * is reporting on — otherwise a May recap would claim a June sale when viewed
 * alone and lose it to the June requote when viewed beside it. Pass the lead's
 * other recaps as `siblings` (see {@link loadConversionDeals}).
 *
 * ## What is not a sale
 *
 * Company transfers (`businessType: 'company_transfer'`) and test records are
 * excluded by the loaders — a transfer is a CSR moving a client, not a sale,
 * on every scorecard in the app.
 */

/** The least a deal must carry to be a quote's conversion. */
export interface ConversionDeal {
  _id: Types.ObjectId;
  leadId?: Types.ObjectId | null;
  quoteRecapId?: Types.ObjectId | null;
  soldDate?: Date | null;
  premium?: number;
}

/** The least a quote recap must carry to be resolved. */
export interface ConversionQuote {
  _id: Types.ObjectId;
  leadId?: Types.ObjectId | null;
  quoteDate?: Date | null;
}

/** New-business deals by the recap they name, and by their lead. Sold-date ascending. */
export interface ConversionDeals<D extends ConversionDeal = ConversionDeal> {
  byRecap: ReadonlyMap<string, readonly D[]>;
  byLead: ReadonlyMap<string, readonly D[]>;
  /**
   * Every recap on each lead in play, keyed by lead id — the arbitration set
   * for "one deal, one quote". Omitted, the quotes being resolved arbitrate
   * among themselves.
   */
  siblings?: ReadonlyMap<string, readonly ConversionQuote[]>;
}

export interface QuoteConversion<D extends ConversionDeal = ConversionDeal> {
  deal: D;
  /** `quote_recap` when the deal names the recap; `lead` when inferred. */
  matchedBy: 'quote_recap' | 'lead';
}

const id = (value: Types.ObjectId | null | undefined): string =>
  value ? String(value) : '';

/** Latest quote first; `_id` breaks a tie so the answer never flips between loads. */
function latestFirst(a: ConversionQuote, b: ConversionQuote): number {
  const at = a.quoteDate?.getTime() ?? 0;
  const bt = b.quoteDate?.getTime() ?? 0;
  return bt - at || id(b._id).localeCompare(id(a._id));
}

/**
 * Pure. Each quote's conversion, keyed by recap id; a quote with none is
 * absent from the map.
 */
export function resolveQuoteConversions<D extends ConversionDeal>(
  quotes: readonly ConversionQuote[],
  deals: ConversionDeals<D>,
  timeZone: string,
): Map<string, QuoteConversion<D>> {
  const out = new Map<string, QuoteConversion<D>>();
  const pendingByLead = new Map<string, ConversionQuote[]>();

  for (const quote of quotes) {
    const direct = deals.byRecap.get(id(quote._id))?.[0];
    if (direct) {
      out.set(id(quote._id), { deal: direct, matchedBy: 'quote_recap' });
      continue;
    }
    const lead = id(quote.leadId);
    if (!lead) continue;
    const list = pendingByLead.get(lead);
    if (list) list.push(quote);
    else pendingByLead.set(lead, [quote]);
  }

  const wanted = new Set(quotes.map((quote) => id(quote._id)));

  for (const [lead, pending] of pendingByLead) {
    const candidates = (deals.byLead.get(lead) ?? []).filter(
      (deal) => !deal.quoteRecapId,
    );
    if (!candidates.length) continue;

    // The arbitration set: every recap on the lead that is not itself named by
    // a deal (a directly-sold recap does not compete for the lead's other sales).
    const named = new Set(
      (deals.byLead.get(lead) ?? []).map((deal) => id(deal.quoteRecapId)),
    );
    for (const quote of quotes) {
      if (deals.byRecap.has(id(quote._id))) named.add(id(quote._id));
    }
    const pool = new Map<string, ConversionQuote>();
    for (const quote of [...(deals.siblings?.get(lead) ?? []), ...pending]) {
      if (!named.has(id(quote._id))) pool.set(id(quote._id), quote);
    }
    const contenders = [...pool.values()]
      .map((quote) => ({
        quote,
        day: businessDay(quote.quoteDate, timeZone) ?? '',
      }))
      .filter((entry) => entry.day !== '')
      .sort((a, b) => latestFirst(a.quote, b.quote));

    const claimed = new Set<string>();
    // Earliest sale first, each to the latest unclaimed quote on or before it.
    for (const deal of candidates) {
      const sold = businessDay(deal.soldDate, timeZone);
      if (!sold) continue;
      const winner = contenders.find(
        (entry) => entry.day <= sold && !claimed.has(id(entry.quote._id)),
      );
      if (!winner) continue;
      claimed.add(id(winner.quote._id));
      if (wanted.has(id(winner.quote._id))) {
        out.set(id(winner.quote._id), { deal, matchedBy: 'lead' });
      }
    }
  }

  return out;
}

function groupBy<T>(
  rows: readonly T[],
  by: (row: T) => Types.ObjectId | null | undefined,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = id(by(row));
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

const DEAL_FIELDS = { leadId: 1, quoteRecapId: 1, soldDate: 1, premium: 1 };

/**
 * The deals and sibling recaps {@link resolveQuoteConversions} needs for
 * `quotes`: three indexed finds (`deals {agencyId, quoteRecapId}`,
 * `deals {agencyId, leadId, soldDate}`, `quoteRecaps {agencyId, leadId, …}`).
 *
 * Models typed loosely so this module imports no feature schema — the worker
 * boundary (see `eslint.config.mjs`) admits `common/` only.
 */
export async function loadConversionDeals(
  models: { deal: Model<any>; quoteRecap: Model<any> },
  agencyId: string,
  quotes: readonly ConversionQuote[],
): Promise<ConversionDeals> {
  // `agencyId` is stored as a string on every tenant record.
  const tenant = { agencyId, isTestRecord: { $ne: true } };
  const recapIds = [...new Set(quotes.map((quote) => id(quote._id)))]
    .filter(Boolean)
    .map((value) => new Types.ObjectId(value));
  const leadIds = [...new Set(quotes.map((quote) => id(quote.leadId)))]
    .filter(Boolean)
    .map((value) => new Types.ObjectId(value));

  const [direct, viaLead, siblings] = await Promise.all([
    recapIds.length
      ? models.deal
          .find(
            {
              ...tenant,
              ...NEW_BUSINESS_MATCH,
              quoteRecapId: { $in: recapIds },
            },
            DEAL_FIELDS,
          )
          .sort({ soldDate: 1, _id: 1 })
          .lean<ConversionDeal[]>()
      : [],
    leadIds.length
      ? models.deal
          .find(
            { ...tenant, ...NEW_BUSINESS_MATCH, leadId: { $in: leadIds } },
            DEAL_FIELDS,
          )
          .sort({ soldDate: 1, _id: 1 })
          .lean<ConversionDeal[]>()
      : [],
    leadIds.length
      ? models.quoteRecap
          .find(
            { ...tenant, leadId: { $in: leadIds } },
            { leadId: 1, quoteDate: 1 },
          )
          .lean<ConversionQuote[]>()
      : [],
  ]);

  return {
    byRecap: groupBy(direct, (deal) => deal.quoteRecapId),
    byLead: groupBy(viaLead, (deal) => deal.leadId),
    siblings: groupBy(siblings, (quote) => quote.leadId),
  };
}
