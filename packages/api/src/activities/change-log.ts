import type { ActivityChange, ActivityChangeKind } from '@sfa/shared';
import { businessDay } from '../common/dates/business-dates';

/**
 * The quote/sold edit log (PAC-65 #9) — turning a `PATCH` into a
 * `field_changed` activity row.
 *
 * ## Why a declared field spec rather than Mongoose's own change tracking
 *
 * `doc.modifiedPaths()` and `doc.getChanges()` report **new** values only;
 * Mongoose exposes no supported accessor for the old one. Even if it did, both
 * `update()` paths write fields the producer did not edit — `policyNumberKey`
 * is kept in lockstep with `policyNumber`, and `deriveTotals` reassigns
 * `premium` / `itemCount` / `productsQuoted` on every patch carrying
 * `policies`. A path-driven diff would report all of those as user edits.
 *
 * A declared spec makes "which fields does the log speak about" a reviewable
 * decision instead of a side effect of assignment order, and leaves this file a
 * pure function — unit-testable with no Mongo.
 *
 * ## The one-way door
 *
 * Nothing normalizes a stored change row on read. Every other value on the Lead
 * Detail surface goes through `normalizePolicyType` / `normalizeCarrier` /
 * `normalizeInsuranceMonth` on the way out, because migrated records hold raw
 * SmartSuite select codes (`carrier: 'B4tEH'`, `policyType: 'eCEuV'`). A change
 * row is written once and read forever, so the **spec's `read` must return the
 * display value** — normalizer applied, date already reduced to a calendar
 * day. Get this wrong and the log preserves gibberish permanently.
 *
 * Which calendar depends on what the date is. A calendar-only fact (a policy's
 * effective date) is stored at UTC midnight and reads back through
 * {@link changeDate}. A **business date** — when a sale or quote happened
 * (PAC-159) — is a real instant, and its day is the agency's: it reads back
 * through {@link changeBusinessDate}, which is why every `read` is handed the
 * caller's zone in a {@link ChangeContext}. A business date frozen on the UTC
 * calendar would be the previous day for any agency east of Greenwich, and
 * there is no re-deriving it later.
 */

/** What a `read` needs beyond the document itself. */
export interface ChangeContext {
  /** The agency's IANA zone — `AccessContext.timeZone`. */
  timeZone: string;
}

/** How to pull one logged field out of a document, and how to label it. */
export interface ChangeFieldSpec<T> {
  /** Stable key, e.g. `premium`. */
  field: string;
  /** What the reader sees. */
  label: string;
  kind: ActivityChangeKind;
  /**
   * The **display-ready** value: normalizer applied, `Date` already reduced to
   * `YYYY-MM-DD`. Return `null` for absent or cleared — never `undefined`.
   */
  read: (doc: T, ctx: ChangeContext) => string | number | string[] | null;
}

/** A field's value at one point in time, keyed by `ChangeFieldSpec.field`. */
export type ChangeSnapshot = Record<string, string | number | string[] | null>;

/**
 * A **calendar-only** date as `YYYY-MM-DD`, or `null`.
 *
 * The same truncation `lead-detail.service.ts`'s `dateOnly` and
 * `policy-view.ts`'s `policyDate` perform, and for the same reason: an
 * effective date is a calendar date stored at UTC midnight, and reading the
 * instant in a local zone is what renders it as the previous day for anyone
 * west of Greenwich. Not for a business date — see {@link changeBusinessDate}.
 */
export function changeDate(value?: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * A **business** date — a sold, quote or lead date — as the agency-calendar
 * `YYYY-MM-DD` it falls on, or `null` (PAC-159). The value the log freezes
 * must be the day the agency means, so the zone is required.
 */
export function changeBusinessDate(
  value: Date | null | undefined,
  timeZone: string,
): string | null {
  return businessDay(value, timeZone);
}

/**
 * Free text reduced to something a timeline row can hold.
 *
 * `notes` accepts 2000 characters, and a change row carries **both** sides —
 * ~4 KB per edit, rendered as a wall of prose in a 40%-width column. The log's
 * job is to say a field changed and roughly how, not to be a document store;
 * the current text is always one click away on the record itself.
 */
export function changeText(value?: string | null, limit = 120): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

/** Read every spec'd field off a document, before or after mutation. */
export function snapshot<T>(
  specs: ChangeFieldSpec<T>[],
  doc: T,
  ctx: ChangeContext,
): ChangeSnapshot {
  const result: ChangeSnapshot = {};
  for (const spec of specs) {
    result[spec.field] = spec.read(doc, ctx) ?? null;
  }
  return result;
}

/**
 * Compare two snapshots, newest spec order preserved.
 *
 * Lists compare order-insensitively: `productsQuoted` is derived with
 * `[...new Set(policies.map(...))]`, so reordering the policy rows reorders it
 * without anything having changed.
 */
export function diffSnapshots<T>(
  specs: ChangeFieldSpec<T>[],
  before: ChangeSnapshot,
  after: ChangeSnapshot,
): ActivityChange[] {
  const changes: ActivityChange[] = [];

  for (const spec of specs) {
    const from = before[spec.field] ?? null;
    const to = after[spec.field] ?? null;
    if (sameValue(from, to)) continue;
    changes.push({
      field: spec.field,
      label: spec.label,
      kind: spec.kind,
      from,
      to,
    });
  }

  return changes;
}

function sameValue(
  a: string | number | string[] | null,
  b: string | number | string[] | null,
): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((value, index) => value === right[index]);
  }
  return a === b;
}
