import {
  normalizeCarrier,
  reconciliationPremiumDelta,
  type BindIdStatus,
  type PolicyOrigin,
  type ReconciliationIgnoredReason,
  type ReconciliationIssue,
  type ReconciliationMatch,
  type ReconciliationTab,
  type ReconciliationTotals,
  type ReconciliationSuggestion,
} from '@sfa/shared';
import { classifyDashRow, isDirectChannel } from './classify-row';
import type { DashRow } from './dash-file-reader';
import {
  bindIdStatus,
  creditFor,
  type DashCredit,
  type ProducerCodeIndex,
} from './producer-code-index';

/**
 * The reconciliation itself: Dash lines against app policies, by policy
 * number. Pure — the run service loads the inputs and stores the output.
 *
 * Two stages, kept apart on purpose:
 *
 * 1. {@link matchRows} pairs lines with policies. It reads only the file and
 *    the app's policies, so its result never changes for a stored run.
 * 2. {@link deriveRow} classifies a matched row against the Allstate codes on
 *    the agency's **users** — who bound it, who Dash credits, which tabs it
 *    belongs in — and checks a matched policy against the app's (premium,
 *    producer, items). Setting someone's Bind ID re-runs only this stage over
 *    the stored rows (`reclassify`), without re-reading the file.
 */

/** An app policy, flattened with its deal — what a Dash line is matched to. */
export interface AppPolicyLite {
  policyId: string;
  policyNumber: string | null;
  /** `reconciliationPolicyKey(policyNumber)`; `''` when it has none. */
  policyKey: string;
  policyType: string | null;
  carrier: string | null;
  policyStatus: string | null;
  premium: number;
  items: number;
  dealId: string | null;
  householdId: string | null;
  producerId: string | null;
  /** The deal's sold date on the agency's calendar, `YYYY-MM-DD`. */
  soldDay: string | null;
  /**
   * A policy with no deal — a 1-800 policy set up for service — has no sold
   * date; its effective date (a UTC calendar day) places it instead, for the
   * window and for suggestions. `null` on a policy with a deal, and absent on
   * every snapshot stored before PAC-173 PR 5.
   */
  effectiveDay?: string | null;
  clientName: string | null;
  businessType: string | null;
  /**
   * `carrier_direct` for a 1-800 policy set up for service (PAC-173 PR 5): no
   * deal, and its Dash line's unknown Bind ID is expected, not a question.
   * `null` — the agency's own, and every snapshot stored before the field.
   */
  origin: PolicyOrigin | null;
  /**
   * Dash ought to list this policy: on a deal sold inside the report period
   * (new business or a company transfer — both issue a new policy number),
   * or a 1-800 policy set up for service that took effect in it, written with
   * a carrier the report covers. Only these can be `app_only` — a policy sold
   * in March is not missing from September's file.
   */
  expectedInDash: boolean;
  /** Sold (or, with no deal, effective) within the padded window — a candidate for suggestions. */
  nearWindow: boolean;
}

export interface ReportWindow {
  from: string;
  to: string;
}

/** A row as matching leaves it — independent of anyone's Allstate codes. */
export interface RowBase {
  rowKey: string;
  side: 'dash' | 'app' | 'both';
  match: ReconciliationMatch | null;
  isSale: boolean;
  ignoredReason: ReconciliationIgnoredReason | null;
  dash: DashRow | null;
  app: AppPolicyLite | null;
  /** Issues matching found; code-dependent ones are added by {@link deriveRow}. */
  matchIssues: ReconciliationIssue[];
  suggestions: SuggestionRaw[];
}

/** A suggestion before row ids exist: a Dash row is named by its `rowKey`. */
export type SuggestionRaw = Omit<ReconciliationSuggestion, 'rowId'> & {
  rowKey: string | null;
};

/** What {@link deriveRow} adds. */
export interface RowDerived {
  bindIdStatus: BindIdStatus | null;
  credit: DashCredit;
  /** `user:<id>`, `bind:<Bind ID>` or `none` — the summary's grouping. */
  producerKey: string;
  issues: ReconciliationIssue[];
  tabs: ReconciliationTab[];
  needsReview: boolean;
}

export type ReconciledRow = RowBase & RowDerived;

// ---------------------------------------------------------------------------
// Stage 1 — matching
// ---------------------------------------------------------------------------

export function matchRows({
  dashRows,
  appPolicies,
  window,
}: {
  dashRows: readonly DashRow[];
  appPolicies: readonly AppPolicyLite[];
  window: ReportWindow | null;
}): RowBase[] {
  const rows: RowBase[] = [];
  const keyCounts = new Map<string, number>();
  const nextKey = (base: string) => {
    const n = (keyCounts.get(base) ?? 0) + 1;
    keyCounts.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };

  // Classify, then keep one sale line per policy number: the earliest issued.
  const classified = dashRows.map((dash) => ({
    dash,
    ...classifyDashRow(dash),
  }));
  const saleByKey = new Map<string, (typeof classified)[number][]>();
  for (const entry of classified) {
    if (!entry.isSale || !entry.dash.policyKey) continue;
    const list = saleByKey.get(entry.dash.policyKey) ?? [];
    list.push(entry);
    saleByKey.set(entry.dash.policyKey, list);
  }
  const repeatedKeys = new Set<string>();
  for (const [key, list] of saleByKey) {
    if (list.length < 2) continue;
    repeatedKeys.add(key);
    list
      .sort(
        (a, b) =>
          (a.dash.issuedDate ?? '').localeCompare(b.dash.issuedDate ?? '') ||
          a.dash.rowNumber - b.dash.rowNumber,
      )
      .slice(1)
      .forEach((entry) => {
        entry.isSale = false;
        entry.ignoredReason = 'duplicate_line';
      });
  }

  const policiesByKey = new Map<string, AppPolicyLite[]>();
  for (const policy of appPolicies) {
    if (!policy.policyKey) continue;
    const list = policiesByKey.get(policy.policyKey) ?? [];
    list.push(policy);
    policiesByKey.set(policy.policyKey, list);
  }

  // Any Dash line — sale or endorsement — proves the carrier has the policy,
  // so none of the app's policies under that number is "not in Dash".
  const inDash = new Set<string>();
  for (const { dash } of classified) {
    for (const policy of policiesByKey.get(dash.policyKey) ?? []) {
      inDash.add(policy.policyId);
    }
  }

  for (const entry of classified) {
    const { dash, isSale, ignoredReason } = entry;
    const matchIssues: ReconciliationIssue[] = [];
    if (repeatedKeys.has(dash.policyKey)) matchIssues.push('duplicate_in_dash');

    let match: ReconciliationMatch | null = null;
    let app: AppPolicyLite | null = null;
    if (isSale) {
      const candidates = dash.policyKey
        ? (policiesByKey.get(dash.policyKey) ?? [])
        : [];
      if (candidates.length) {
        app = closestPolicy(candidates, dash.dateWritten ?? dash.issuedDate);
        match = 'matched';
        if (candidates.length > 1) matchIssues.push('duplicate_in_app');
        if (window && app.soldDay && !inWindow(app.soldDay, window)) {
          matchIssues.push('outside_window');
        }
      } else {
        match = 'dash_only';
      }
    }

    rows.push({
      rowKey: nextKey(
        `dash:${dash.policyKey || `line${dash.rowNumber}`}:${slug(dash.transactionType)}:${dash.issuedDate ?? '-'}`,
      ),
      side: app ? 'both' : 'dash',
      match,
      isSale,
      ignoredReason,
      dash,
      app,
      matchIssues,
      suggestions: [],
    });
  }

  for (const policy of appPolicies) {
    if (!policy.expectedInDash || inDash.has(policy.policyId)) continue;
    const matchIssues: ReconciliationIssue[] = [];
    if (!policy.policyKey) matchIssues.push('missing_policy_number');
    else if (!looksLikeCarrierNumber(policy.policyKey, policy.carrier)) {
      matchIssues.push('number_format');
    }
    if ((policiesByKey.get(policy.policyKey)?.length ?? 0) > 1) {
      matchIssues.push('duplicate_in_app');
    }
    rows.push({
      rowKey: nextKey(`app:${policy.policyId}`),
      side: 'app',
      match: 'app_only',
      isSale: false,
      ignoredReason: null,
      dash: null,
      app: policy,
      matchIssues,
      suggestions: [],
    });
  }

  attachSuggestions(
    rows,
    appPolicies.filter((p) => p.nearWindow && !inDash.has(p.policyId)),
  );
  return rows;
}

/**
 * The candidate sold closest to the Dash date; a deal-less policy last, so a
 * number booked on a sale is always the one checked — a 1-800 policy recorded
 * as a sale beside its own serviced copy must still read as one. Deal-less
 * candidates (a serviced 1-800 policy) rank among themselves by the day they
 * took effect, then newest first: a row set up for service again after the
 * owner reopened it made a second copy, and the newer one is what its outcome
 * links.
 */
function closestPolicy(
  candidates: readonly AppPolicyLite[],
  day: string | null,
): AppPolicyLite {
  const distance = (policy: AppPolicyLite) => {
    const known = policy.dealId ? policy.soldDay : policy.effectiveDay;
    return known && day ? Math.abs(daysBetween(known, day)) : 1e9;
  };
  return [...candidates].sort(
    (a, b) =>
      Number(!!b.dealId) - Number(!!a.dealId) ||
      distance(a) - distance(b) ||
      Number(b.expectedInDash) - Number(a.expectedInDash) ||
      (a.dealId
        ? a.policyId.localeCompare(b.policyId)
        : b.policyId.localeCompare(a.policyId)),
  )[0];
}

function inWindow(day: string, window: ReportWindow): boolean {
  return day >= window.from && day <= window.to;
}

/**
 * Allstate numbers are nine digits and National General's ten — the data
 * team's tell for a typo ("only 8 digits — likely a missing digit"). Other
 * carriers have no rule here.
 */
export function looksLikeCarrierNumber(
  key: string,
  carrier: string | null,
): boolean {
  const name = normalizeCarrier(carrier).toLowerCase();
  if (name === 'allstate') return /^\d{9}$/.test(key);
  if (name.startsWith('national general')) return /^\d{10}$/.test(key);
  if (!name) return /^\d{9,10}$/.test(key);
  return true;
}

// ---------------------------------------------------------------------------
// Suggestions — the likely counterpart of an unmatched row
// ---------------------------------------------------------------------------

const MAX_SUGGESTIONS = 3;

function attachSuggestions(
  rows: RowBase[],
  freePolicies: readonly AppPolicyLite[],
): void {
  const missing = rows.filter((row) => row.match === 'dash_only' && row.dash);
  for (const row of missing) {
    const dash = row.dash!;
    row.suggestions = rank(
      freePolicies.map((policy) => ({
        score: scorePair(
          {
            key: dash.policyKey,
            name: dash.customerName,
            premium: dash.writtenPremium,
            day: dash.dateWritten ?? dash.issuedDate,
          },
          {
            key: policy.policyKey,
            name: policy.clientName,
            premium: policy.premium,
            day: policy.soldDay ?? policy.effectiveDay ?? null,
          },
        ),
        suggestion: {
          kind: 'app_policy' as const,
          policyId: policy.policyId,
          dealId: policy.dealId,
          householdId: policy.householdId,
          rowKey: null,
          policyNumber: policy.policyNumber,
          name: policy.clientName,
          premium: policy.premium,
          day: policy.soldDay ?? policy.effectiveDay ?? null,
          reasons: [],
        },
      })),
    );
  }

  for (const row of rows) {
    if (row.match !== 'app_only' || !row.app) continue;
    const app = row.app;
    row.suggestions = rank(
      missing.map((other) => ({
        score: scorePair(
          {
            key: app.policyKey,
            name: app.clientName,
            premium: app.premium,
            day: app.soldDay ?? app.effectiveDay ?? null,
          },
          {
            key: other.dash!.policyKey,
            name: other.dash!.customerName,
            premium: other.dash!.writtenPremium,
            day: other.dash!.dateWritten ?? other.dash!.issuedDate,
          },
        ),
        suggestion: {
          kind: 'dash_row' as const,
          policyId: null,
          dealId: null,
          householdId: null,
          rowKey: other.rowKey,
          policyNumber: other.dash!.policyNumber,
          name: other.dash!.customerName,
          premium: other.dash!.writtenPremium,
          day: other.dash!.dateWritten ?? other.dash!.issuedDate,
          reasons: [],
        },
      })),
    );
  }
}

interface PairSide {
  key: string;
  name: string | null;
  premium: number | null;
  day: string | null;
}

type Reason = ReconciliationSuggestion['reasons'][number];

/**
 * Why two unmatched rows might be the same policy, or `null` if they are not
 * worth showing. A near-identical number stands on its own (a transposed or
 * dropped digit); otherwise the surname has to agree **and** the premium or
 * the date has to be close.
 */
export function scorePair(
  a: PairSide,
  b: PairSide,
): { score: number; reasons: Reason[] } | null {
  const reasons: Reason[] = [];
  let score = 0;
  if (
    a.key.length >= 6 &&
    b.key.length >= 6 &&
    a.key !== b.key &&
    editDistance(a.key, b.key) <= 2
  ) {
    reasons.push('number_close');
    score += 4;
  }
  const surnameA = surname(a.name);
  if (surnameA && surnameA === surname(b.name)) {
    reasons.push('same_surname');
    score += 2;
  }
  if (
    a.premium != null &&
    b.premium != null &&
    Math.max(a.premium, b.premium) > 0 &&
    Math.abs(a.premium - b.premium) <= 0.1 * Math.max(a.premium, b.premium)
  ) {
    reasons.push('premium_close');
    score += 1;
  }
  if (a.day && b.day && Math.abs(daysBetween(a.day, b.day)) <= 7) {
    reasons.push('date_close');
    score += 1;
  }
  const qualifies =
    reasons.includes('number_close') ||
    (reasons.includes('same_surname') &&
      (reasons.includes('premium_close') || reasons.includes('date_close')));
  return qualifies ? { score, reasons } : null;
}

function rank(
  scored: {
    score: ReturnType<typeof scorePair>;
    suggestion: SuggestionRaw;
  }[],
): SuggestionRaw[] {
  return scored
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score!.score - a.score!.score)
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => ({ ...entry.suggestion, reasons: entry.score!.reasons }));
}

const NAME_SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);

/** The last word of a person's name, upper-cased, ignoring Jr/Sr/III. */
export function surname(name: string | null): string | null {
  if (!name) return null;
  const words = name
    .toUpperCase()
    .replace(/[^A-Z\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !NAME_SUFFIXES.has(word));
  return words.length >= 2 ? words[words.length - 1] : null;
}

/** Levenshtein distance — policy numbers are ten characters at most. */
export function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

/** Whole days from `a` to `b`, both `YYYY-MM-DD`. */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

function slug(value: string | null): string {
  return (value ?? '-').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// ---------------------------------------------------------------------------
// Stage 2 — classification against the users' Allstate codes
// ---------------------------------------------------------------------------

/** Tabs whose rows wait on a person. */
const REVIEW_TABS: ReadonlySet<ReconciliationTab> = new Set([
  'missing_from_app',
  'not_in_dash',
  'review_1800',
  'premium_mismatch',
  'producer_mismatch',
]);

/**
 * Whether a row's own tabs ask for a decision — {@link deriveRow}'s
 * `needsReview`, for a stored row whose flag a pending service intake held up
 * (PAC-173 PR 5). `besides` leaves out the tab an outcome just answered.
 */
export function asksForDecision(
  tabs: readonly ReconciliationTab[],
  besides?: ReconciliationTab,
): boolean {
  return tabs.some((tab) => tab !== besides && REVIEW_TABS.has(tab));
}

export function deriveRow(base: RowBase, codes: ProducerCodeIndex): RowDerived {
  const issues = new Set<ReconciliationIssue>(base.matchIssues);
  const tabs = new Set<ReconciliationTab>();
  const { dash, app } = base;

  let status: BindIdStatus | null = null;
  let credit: DashCredit = { name: null, userId: null, via: 'none' };
  let direct = false;

  if (dash) {
    status = bindIdStatus(dash, codes);
    credit = creditFor(dash, codes);
    direct = isDirectChannel(dash.channel);
    if (status === 'not_staff') issues.add('not_staff_bind_id');
    if (status === 'former_staff') issues.add('former_staff_bind_id');
    if (status === 'blank') issues.add('no_bind_id');
    if (direct) issues.add('direct_channel');
    if (!base.isSale) tabs.add('ignored');
  }

  // Allstate sold it, the agency services it. The Bind ID decides: a login
  // on none of the agency's users that Dash prints no name for (a named one
  // is a former employee's). On a new policy that is enough;
  // on any other line (an item added) only when the line also came through
  // the 1-800 or web channel — machine ids on routine endorsements are noise.
  // A producer's own login is never 1-800, whatever the channel: a customer
  // who started on allstate.com and was bound by the agency is the agency's.
  // A 1-800 policy already set up for service (`carrier_direct`) is the
  // answer to that question, so it is not asked again: the row is matched,
  // with `direct_1800` saying why its binder is nobody here. Only while it has
  // no deal — one put on a sale since is exactly what 1-800 review is for
  // (`direct_recorded_as_sale`).
  const serviced =
    base.match === 'matched' && app?.origin === 'carrier_direct' && !app.dealId;
  const isDirect =
    !!dash && status === 'not_staff' && (base.isSale || direct) && !serviced;

  // A matched policy is checked against the app's, which is the source of
  // truth: any difference is for a person to look at. Its producer is
  // whoever's Bind ID bound it; the deal naming someone else is a mismatch.
  if (base.match === 'matched') {
    tabs.add('matched');
    // Serviced, never sold: no deal, so no producer to have or to differ.
    if (serviced) issues.add('direct_1800');
    else if (!app?.producerId) issues.add('no_app_producer');
    else if (credit.userId && credit.userId !== app.producerId) {
      issues.add('producer_mismatch');
      tabs.add('producer_mismatch');
    }
    // Even a cent (David, 27 Oct 2026). Most are fees the app includes and
    // Dash's written premium does not.
    const delta = reconciliationPremiumDelta(
      dash?.writtenPremium,
      app?.premium,
    );
    if (delta !== null && delta !== 0) {
      issues.add('premium_mismatch');
      tabs.add('premium_mismatch');
    }
    if (dash?.itemCount != null && app && dash.itemCount !== app.items) {
      issues.add('item_count_mismatch');
    }
    // A 1-800 policy is serviced, never sold, so one the app has on a deal
    // was recorded as somebody's sale. The row is in 1-800 review already
    // (its Bind ID makes it direct); this says why. A login Dash names is a
    // former employee's — the agency's own sale — and never counts.
    if (app?.dealId && status === 'not_staff') {
      issues.add('direct_recorded_as_sale');
    }
  }
  if (base.match === 'dash_only' && !isDirect) tabs.add('missing_from_app');
  if (base.match === 'app_only') tabs.add('not_in_dash');
  if (isDirect) tabs.add('review_1800');

  const needsReview = asksForDecision([...tabs]);

  let producerKey = 'none';
  if (dash) {
    if (credit.userId) producerKey = `user:${credit.userId}`;
    // A former employee gets a line of their own in the summary rather than
    // being pooled with the lines that name nobody.
    else if (credit.via === 'bind_id' && dash.bindIdKey) {
      producerKey = `bind:${dash.bindIdKey}`;
    }
  } else if (app?.producerId) {
    producerKey = `user:${app.producerId}`;
  }

  return {
    bindIdStatus: status,
    credit,
    producerKey,
    issues: [...issues].sort(),
    tabs: [...tabs],
    needsReview,
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface ProducerSummaryRaw {
  producerKey: string;
  userId: string | null;
  /** The name Dash printed, for a producer with no app user. */
  dashName: string | null;
  dashSales: number;
  dashPremium: number;
  matched: number;
  missing: number;
  missingPremium: number;
  appOnly: number;
  appOnlyPremium: number;
  mismatches: number;
  captureRate: number | null;
}

type SummaryRow = Pick<
  ReconciledRow,
  'isSale' | 'dash' | 'app' | 'tabs' | 'issues' | 'producerKey' | 'credit'
>;

export function summarize(rows: readonly SummaryRow[]): {
  totals: ReconciliationTotals;
  byProducer: ProducerSummaryRaw[];
} {
  const totals: ReconciliationTotals = {
    dashRows: 0,
    dashSales: 0,
    ignored: 0,
    matched: 0,
    missing: 0,
    appOnly: 0,
    review1800: 0,
    premiumMismatch: 0,
    producerMismatch: 0,
    dashPremium: 0,
    matchedPremium: 0,
    missingPremium: 0,
    appOnlyPremium: 0,
    review1800Premium: 0,
    premiumMismatchDelta: 0,
    captureRate: null,
  };
  const producers = new Map<string, ProducerSummaryRaw>();
  const producer = (row: SummaryRow): ProducerSummaryRaw => {
    let entry = producers.get(row.producerKey);
    if (!entry) {
      entry = {
        producerKey: row.producerKey,
        userId: row.producerKey.startsWith('user:')
          ? row.producerKey.slice(5)
          : null,
        dashName: null,
        dashSales: 0,
        dashPremium: 0,
        matched: 0,
        missing: 0,
        missingPremium: 0,
        appOnly: 0,
        appOnlyPremium: 0,
        mismatches: 0,
        captureRate: null,
      };
      producers.set(row.producerKey, entry);
    }
    if (!entry.dashName && row.credit.name) entry.dashName = row.credit.name;
    return entry;
  };

  for (const row of rows) {
    const tabs = new Set(row.tabs);
    const premium = row.dash?.writtenPremium ?? 0;
    if (row.dash) {
      totals.dashRows += 1;
      if (!row.isSale) totals.ignored += 1;
    }
    if (row.isSale) {
      totals.dashSales += 1;
      totals.dashPremium += premium;
    }
    if (tabs.has('matched')) {
      totals.matched += 1;
      totals.matchedPremium += premium;
    }
    if (tabs.has('missing_from_app')) {
      totals.missing += 1;
      totals.missingPremium += premium;
    }
    if (tabs.has('not_in_dash')) {
      totals.appOnly += 1;
      totals.appOnlyPremium += row.app?.premium ?? 0;
    }
    if (tabs.has('review_1800')) {
      totals.review1800 += 1;
      if (row.isSale) totals.review1800Premium += premium;
    }
    if (tabs.has('premium_mismatch')) {
      totals.premiumMismatch += 1;
      totals.premiumMismatchDelta += Math.abs(
        reconciliationPremiumDelta(
          row.dash?.writtenPremium,
          row.app?.premium,
        ) ?? 0,
      );
    }
    if (tabs.has('producer_mismatch')) totals.producerMismatch += 1;

    // The per-producer table is the agency's own business: 1-800 lines are
    // nobody's to capture — in review, set up for service (`direct_1800`), or
    // a serviced policy Dash left out.
    const allstateDirect =
      tabs.has('review_1800') ||
      row.issues.includes('direct_1800') ||
      (row.app?.origin === 'carrier_direct' && !row.app.dealId);
    if (allstateDirect) continue;
    if (row.isSale) {
      const entry = producer(row);
      entry.dashSales += 1;
      entry.dashPremium += premium;
      if (tabs.has('matched')) entry.matched += 1;
      if (tabs.has('missing_from_app')) {
        entry.missing += 1;
        entry.missingPremium += premium;
      }
      if (tabs.has('producer_mismatch')) entry.mismatches += 1;
    } else if (tabs.has('not_in_dash')) {
      const entry = producer(row);
      entry.appOnly += 1;
      entry.appOnlyPremium += row.app?.premium ?? 0;
    }
  }

  totals.captureRate = rate(totals.matched, totals.missing);
  for (const key of [
    'dashPremium',
    'matchedPremium',
    'missingPremium',
    'appOnlyPremium',
    'review1800Premium',
    'premiumMismatchDelta',
  ] as const) {
    totals[key] = cents(totals[key]);
  }
  const byProducer = [...producers.values()]
    .map((entry) => ({
      ...entry,
      dashPremium: cents(entry.dashPremium),
      missingPremium: cents(entry.missingPremium),
      appOnlyPremium: cents(entry.appOnlyPremium),
      captureRate: rate(entry.matched, entry.missing),
    }))
    .sort(
      (a, b) =>
        b.dashSales - a.dashSales ||
        b.appOnly - a.appOnly ||
        a.producerKey.localeCompare(b.producerKey),
    );
  return { totals, byProducer };
}

function rate(matched: number, missing: number): number | null {
  const denominator = matched + missing;
  return denominator ? matched / denominator : null;
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}
