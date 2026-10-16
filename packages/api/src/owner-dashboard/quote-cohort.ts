import { isLostLeadStatus, normalizePolicyType } from '@sfa/shared';
import type { Types } from 'mongoose';
import type {
  ConversionDeal,
  QuoteConversion,
} from '../common/sales-metrics/quote-conversion';

/**
 * The Owner dashboard's quote figures, as pure functions of rows already read
 * (David, 14–15 Oct 2026: "the biggest item is the ability to see the quotes
 * because this is uncaptured revenue").
 *
 * Every quote written in a window is **sold**, **open** or **lost** — see the
 * module docblock of `owner-dashboard.ts` in `@sfa/shared`. Kept apart from the
 * service so the rules can be tested without a database.
 */

/** A quote recap as `OwnerDashboardService.quoteCohort` projects it. */
export interface CohortQuote {
  _id: Types.ObjectId;
  producerId?: Types.ObjectId | null;
  leadId?: Types.ObjectId | null;
  householdId?: Types.ObjectId | null;
  /** Always set: the cohort is matched on it. */
  quoteDate: Date;
  /** Quoted premium on the lines that survived the line-of-business filter. */
  linePremium: number;
  productsQuoted?: string[];
  policies?: { policyType?: string }[];
}

/** The quote's lead, as much of it as the figures need. */
export interface CohortLead {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  status?: string | null;
}

export type QuoteOutcome = 'sold' | 'open' | 'lost';

export type Conversions = ReadonlyMap<string, QuoteConversion<ConversionDeal>>;
export type Leads = ReadonlyMap<string, CohortLead>;

const key = (id: Types.ObjectId | null | undefined): string =>
  id ? String(id) : '';

/**
 * A sale beats everything; then a lead that is finished without one makes the
 * quote lost. A quote with no lead on record is open — there is nobody to have
 * lost — and so is one whose lead says Sold with no deal behind it.
 */
export function quoteOutcome(
  hasConversion: boolean,
  lead: CohortLead | undefined,
): QuoteOutcome {
  if (hasConversion) return 'sold';
  if (lead && isLostLeadStatus(lead.status)) return 'lost';
  return 'open';
}

export function outcomeOf(
  quote: CohortQuote,
  conversions: Conversions,
  leads: Leads,
): QuoteOutcome {
  return quoteOutcome(
    conversions.has(key(quote._id)),
    leads.get(key(quote.leadId)),
  );
}

/**
 * Lines of business quoted, as canonical labels. `productsQuoted` is the
 * recap's own list (raw SmartSuite codes on migrated rows, hence the
 * normalize); the per-line types are the fallback when it is empty.
 */
export function productsOf(quote: CohortQuote): string[] {
  const raw = quote.productsQuoted?.length
    ? quote.productsQuoted
    : (quote.policies ?? []).map((line) => line.policyType ?? '');
  const out = new Set<string>();
  for (const value of raw) {
    const label = normalizePolicyType(value);
    if (label) out.add(label);
  }
  return [...out];
}

export interface QuoteCounts {
  written: number;
  sold: number;
  open: number;
  lost: number;
  openPremium: number;
}

export const EMPTY_COUNTS: QuoteCounts = {
  written: 0,
  sold: 0,
  open: 0,
  lost: 0,
  openPremium: 0,
};

/** Counts per producer; `''` is the quotes with no producer ("Unassigned"). */
export function producerQuoteCounts(
  quotes: readonly CohortQuote[],
  conversions: Conversions,
  leads: Leads,
): Map<string, QuoteCounts> {
  const out = new Map<string, QuoteCounts>();
  for (const quote of quotes) {
    const id = key(quote.producerId);
    const row = out.get(id) ?? { ...EMPTY_COUNTS };
    const outcome = outcomeOf(quote, conversions, leads);
    row.written += 1;
    row[outcome] += 1;
    if (outcome === 'open') row.openPremium += quote.linePremium ?? 0;
    out.set(id, row);
  }
  return out;
}

/** Instants bounding a window, as `instantWindow` gives them. */
export interface InstantBounds {
  $gte: Date;
  $lt: Date;
}

/**
 * The "Unsold quotes closed" figures for one window, over the quotes written
 * in its backlog span (the `QUOTE_BACKLOG_DAYS` before it starts).
 *
 * - **In the backlog** if, at the window's start, it was not yet sold — no sale
 *   at all, or a sale on or after the start — and is not on a lost lead.
 *   Lost prunes only *unsold* quotes, so every recovery is in the backlog.
 * - **Recovered** if that sale fell inside the window.
 * - The premium is each recovered deal's once, however many quotes it closed.
 */
export function backlogStats(
  quotes: readonly CohortQuote[],
  conversions: Conversions,
  leads: Leads,
  window: InstantBounds,
): { backlogAtStart: number; recovered: number; recoveredPremium: number } {
  let backlogAtStart = 0;
  let recovered = 0;
  const deals = new Map<string, number>();

  for (const quote of quotes) {
    const sold = conversions.get(key(quote._id))?.deal;
    const soldAt = sold?.soldDate?.getTime();
    if (sold && soldAt !== undefined) {
      if (soldAt < window.$gte.getTime()) continue;
      backlogAtStart += 1;
      if (soldAt < window.$lt.getTime()) {
        recovered += 1;
        deals.set(key(sold._id), sold.premium ?? 0);
      }
      continue;
    }
    if (outcomeOf(quote, conversions, leads) === 'lost') continue;
    backlogAtStart += 1;
  }

  const recoveredPremium = [...deals.values()].reduce((a, b) => a + b, 0);
  return { backlogAtStart, recovered, recoveredPremium };
}

/** First + last name, or `Unknown lead` — the Manager view's `leadName` rule. */
export function clientNameOf(lead: CohortLead | undefined): string {
  const name = [lead?.firstName, lead?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return name || 'Unknown lead';
}
