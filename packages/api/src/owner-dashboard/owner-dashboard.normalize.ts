import {
  MIN_QUOTES_PER_SALE,
  POLICY_TYPES,
  normalizePolicyType,
} from '@sfa/shared';
import type {
  OwnerBlendedClosingRatio,
  OwnerClosingRatio,
  OwnerClosingRatioBasis,
  OwnerLobMix,
  OwnerQuoteClosingRatio,
  OwnerRatioGap,
  OwnerTrend,
  OwnerUnsoldQuotesClosed,
} from '@sfa/shared';

/** One decimal place — enough for a badge, stable enough to assert on. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A figure against the same figure for the comparison window.
 *
 * `hasPriorData` is asked of the *window*, not of the figure: a previous period
 * that held sales worth $0 is data, while one that held nothing at all — the
 * business may not have existed — is not, and must never render as a −100% or a
 * +∞% badge. `change` is also `null` whenever either side is undefined or the
 * base is zero, since "up from nothing" has no percentage.
 */
export function toTrend(
  current: number | null,
  previous: number | null,
  hasPriorData: boolean,
  unit: OwnerTrend['unit'] = 'percent',
): OwnerTrend {
  const comparable = hasPriorData && current !== null && previous !== null;

  let change: number | null = null;
  if (comparable) {
    if (unit === 'points') change = round1(current - previous);
    else if (previous !== 0) {
      change = round1(((current - previous) / Math.abs(previous)) * 100);
    }
  }

  return {
    current,
    previous: hasPriorData ? previous : null,
    change,
    unit,
    status: hasPriorData ? 'ok' : 'no_prior_data',
  };
}

/** Sold ÷ quoted premium as a percentage; `null` when nothing was quoted. */
export function ratioPct(sold: number, quoted: number): number | null {
  return quoted > 0 ? round1((sold / quoted) * 100) : null;
}

export interface RatioSide {
  soldPremium: number;
  quotedPremium: number;
  /** Quote recaps in the window — what "was anything quoted?" is asked of. */
  quoteCount: number;
  /** Sales in the window — what "is that enough quotes?" is measured against. */
  soldCount: number;
}

/**
 * Sold ÷ quoted premium for one side, or the reason there is no such figure.
 *
 * The card and every row of the lead-source table go through this, so a source
 * cannot show a conversion rate the card above it would have refused to.
 */
export function closingPct(side: RatioSide): {
  pct: number | null;
  gap: OwnerRatioGap | null;
} {
  if (side.quoteCount === 0 || side.quotedPremium <= 0) {
    return { pct: null, gap: 'no_quotes' };
  }
  if (side.quoteCount < side.soldCount * MIN_QUOTES_PER_SALE) {
    return { pct: null, gap: 'too_few_quotes' };
  }
  return { pct: ratioPct(side.soldPremium, side.quotedPremium), gap: null };
}

/**
 * The premium closing ratio, moved in percentage **points**.
 *
 * "No prior data" here means no *usable* ratio in the comparison window,
 * whatever was sold in it — see {@link closingPct}.
 */
export function toClosingRatio(
  current: RatioSide,
  previous: RatioSide,
): OwnerClosingRatio {
  const { pct: value, gap } = closingPct(current);
  const { pct: prior } = closingPct(previous);

  return {
    ...toTrend(value, prior, prior !== null, 'points'),
    soldPremium: roundCents(current.soldPremium),
    quotedPremium: roundCents(current.quotedPremium),
    reason: gap,
  };
}

/** Quotes sold ÷ quotes written, one side of the quote closing ratio. */
export interface QuoteSide {
  written: number;
  sold: number;
}

function quotePct(side: QuoteSide): number | null {
  return side.written > 0 ? round1((side.sold / side.written) * 100) : null;
}

/**
 * The quote closing ratio, moved in percentage **points**. No
 * `MIN_QUOTES_PER_SALE` guard: it is a cohort (`sold ⊆ written`), so it cannot
 * run past 100 the way sold ÷ quoted premium can.
 */
export function toQuoteClosingRatio(
  current: QuoteSide,
  previous: QuoteSide,
): OwnerQuoteClosingRatio {
  const prior = quotePct(previous);
  return {
    ...toTrend(quotePct(current), prior, prior !== null, 'points'),
    written: current.written,
    sold: current.sold,
    reason: current.written > 0 ? null : 'no_quotes',
  };
}

/** The mean of whichever sides have a figure; `null` when neither does. */
export function blendPct(
  premium: number | null,
  quote: number | null,
): number | null {
  if (premium !== null && quote !== null) return round1((premium + quote) / 2);
  return premium ?? quote;
}

function basisOf(
  premium: number | null,
  quote: number | null,
): OwnerClosingRatioBasis {
  if (premium !== null && quote !== null) return 'both';
  if (premium !== null) return 'premium';
  if (quote !== null) return 'quote';
  return 'none';
}

/**
 * The Agency Closing Ratio card: the average of the premium and quote closing
 * ratios (David, 14 Oct 2026), with both sides kept so the card can say which
 * figures it averaged. The headline's trend is the blend now against the blend
 * of the comparison window, in points.
 */
export function toBlendedClosingRatio(
  premium: OwnerClosingRatio,
  quote: OwnerQuoteClosingRatio,
): OwnerBlendedClosingRatio {
  const now = blendPct(premium.current, quote.current);
  const prior = blendPct(premium.previous, quote.previous);
  const basis = basisOf(premium.current, quote.current);
  return {
    ...toTrend(now, prior, prior !== null, 'points'),
    basis,
    premium,
    quote,
    reason: basis === 'none' ? premium.reason : null,
  };
}

/** One window's backlog figures. */
export interface BacklogSide {
  backlogAtStart: number;
  recovered: number;
  recoveredPremium: number;
}

/**
 * The "Unsold quotes closed" card. "Anything to compare with" is asked of the
 * comparison window's backlog: one that held no open quotes has no recovery
 * figure to trend against, which is a state, not a −100%.
 */
export function toUnsoldQuotesClosed(
  current: BacklogSide,
  previous: BacklogSide,
): OwnerUnsoldQuotesClosed {
  return {
    recovered: toTrend(
      current.recovered,
      previous.recovered,
      previous.backlogAtStart > 0,
    ),
    recoveredPremium: roundCents(current.recoveredPremium),
    backlogAtStart: current.backlogAtStart,
    ratePct:
      current.backlogAtStart > 0
        ? round1((current.recovered / current.backlogAtStart) * 100)
        : null,
  };
}

/**
 * Top three policy types by share of **policies** sold.
 *
 * Grouped again here, after the pipeline: stored `policyType` is a label on some
 * rows and a raw SmartSuite code on others, so two buckets can be the same type.
 * `otherPct` is the remainder rather than a sum of rounded parts, so the bar
 * always closes at exactly 100.
 *
 * A value that is not one of `POLICY_TYPES` — an uncatalogued SmartSuite code —
 * still counts as a policy sold, but can never be a *named* slice: an owner
 * should not be shown "Zz9Qx 4%". It lands in `otherPct`.
 */
export function toLobMix(
  rows: readonly { policyType: string | null; count: number }[],
): OwnerLobMix {
  const byType = new Map<string, number>();
  for (const row of rows) {
    const label = normalizePolicyType(row.policyType);
    if (!label) continue;
    byType.set(label, (byType.get(label) ?? 0) + row.count);
  }

  const policyCount = [...byType.values()].reduce((sum, n) => sum + n, 0);
  if (policyCount === 0) return { policyCount: 0, top: [], otherPct: 0 };

  const named = new Set<string>(POLICY_TYPES);
  const top = [...byType.entries()]
    .filter(([policyType]) => named.has(policyType))
    // Count desc, then name, so equal types never swap places between loads.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([policyType, count]) => ({
      policyType,
      policyCount: count,
      pct: round1((count / policyCount) * 100),
    }));

  const shown = top.reduce((sum, slice) => sum + slice.pct, 0);
  return { policyCount, top, otherPct: Math.max(0, round1(100 - shown)) };
}

export { round1, roundCents };
