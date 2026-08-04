import { isAutoPolicyType, normalizePolicyType } from '@sfa/shared';
import type { DealAuditTriggers } from '../deals/schemas/deal.schema';

/**
 * Which audit items a sold deal requires (PAC-40).
 *
 * A pure port of legacy's `maybeCreateDealAuditItems`, which is more precise
 * than the spec's outline and is therefore the behaviour source-of-truth. No
 * Mongoose here: this decides *what* is required, and the service decides how
 * to persist it.
 *
 * ## The vocabulary is a contract, not a description
 *
 * Every string below must match an `auditTemplates.name` exactly, because the
 * generator resolves titles by name. A title with no active template is
 * skipped — silently, in legacy — so a rename here disables an item rather
 * than renaming it. The core seed (`seed/audit-templates.seed.ts`) owns the
 * matching list.
 *
 * Two mappings exist because the form and the checklist use different words
 * for the same thing:
 *   - Card 5's "Roof Receipt"      → `Hail Resistant Roof`
 *   - Card 5's "Student Discount"  → `Good Student`
 */

/** One item the deal needs, before it is resolved against a template. */
export interface RequiredAuditItem {
  title: string;
  /**
   * Set when one template fans out into several items — today only Defensive
   * Driver, which produces one certificate per named driver. Also suffixed
   * onto the item name so the hand-off board can tell them apart.
   */
  subjectName?: string;
}

/** A template as the algorithm needs to see it. */
export interface AuditTemplateLike {
  name?: string;
  category?: string;
  alwaysInclude?: boolean;
}

export interface RequiredTitlesInput {
  /** Canonical or raw — normalized here, so either form classifies the same. */
  policyTypes: string[];
  /** Escrow on any policy. Gates the Mortgagee items. */
  mortgagee: boolean;
  triggers: DealAuditTriggers;
  /** Only the **active** templates; the caller filters. */
  templates: AuditTemplateLike[];
}

/** Case/whitespace-insensitive key for matching a title to a template. */
export function normalizeTitle(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeCategory(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Is this template part of every deal's checklist?
 *
 * `alwaysInclude`, **or** a category of exactly `Common`. The exact match is
 * bug-compatible with legacy on purpose: a template categorised "Common Docs"
 * is *not* baseline there, and quietly widening the rule here would add items
 * to every historical deal's expected set.
 */
export function isBaselineTemplate(template: AuditTemplateLike): boolean {
  return (
    template.alwaysInclude === true ||
    normalizeCategory(template.category) === 'common'
  );
}

/** Property lines that take the **Home** variant of a paired item. */
function isHomeVariant(policyType: string): boolean {
  const type = normalizePolicyType(policyType);
  return type === 'Home' || type === 'Renters' || type === 'Condominium';
}

function isLandlord(policyType: string): boolean {
  return normalizePolicyType(policyType) === 'Landlord';
}

/**
 * The full set of items a deal requires: baseline ∪ discount triggers ∪
 * policy-type-deterministic titles.
 *
 * Deduped by `(title, subjectName)`, so a title that is both baseline and
 * triggered appears once — while two named drivers still produce two items.
 */
export function computeRequiredTitles(
  input: RequiredTitlesInput,
): RequiredAuditItem[] {
  const { policyTypes, mortgagee, triggers, templates } = input;

  const hasAuto = policyTypes.some(isAutoPolicyType);
  const hasHome = policyTypes.some(isHomeVariant);
  const hasLandlord = policyTypes.some(isLandlord);

  const items: RequiredAuditItem[] = [];
  const add = (title: string, subjectName?: string) =>
    items.push({ title, subjectName });

  // 1. Baseline — every deal, regardless of what was sold.
  for (const template of templates) {
    if (isBaselineTemplate(template) && template.name) add(template.name);
  }

  // 2. Flat discount triggers.
  if (triggers.goodStudent) add('Good Student');
  if (triggers.drivewise) add('Drivewise');

  // 2b. Defensive Driver fans out per named driver — the spec wants one
  // certificate each, where legacy created a single item for all of them.
  if (triggers.defensiveDriver) {
    const names = triggers.defensiveDriverNames ?? [];
    if (names.length) {
      for (const name of names) add('Defensive Driver', name);
    } else {
      // Ticked but nobody named: still chase it, just without a subject.
      add('Defensive Driver');
    }
  }

  // 3. Variant triggers. **Both** variants are added when the deal carries
  //    both a home-like and a landlord line — legacy does the same, because
  //    each property needs its own proof.
  const addVariants = (suffix: string) => {
    if (hasHome) add(`Home ${suffix}`);
    if (hasLandlord) add(`Landlord ${suffix}`);
  };
  if (triggers.fireSubscription) addVariants('Fire Subscription');
  if (triggers.actualCashValue) addVariants('Actual Cash Value');
  if (triggers.hailResistantRoof) addVariants('Hail Resistant Roof');

  // 4. Policy-type deterministic — not discount-driven at all.
  if (hasAuto) add('Drivers Verified');
  if (hasHome) add('Home Inspection');
  if (hasLandlord) add('Landlord Inspection');
  // Escrow is how this form expresses a mortgagee; the spec never asks for one
  // directly, so it is inferred rather than captured.
  if (hasHome && mortgagee) add('Home Mortgagee');
  if (hasLandlord && mortgagee) add('Landlord Mortgagee');

  return dedupe(items);
}

function dedupe(items: RequiredAuditItem[]): RequiredAuditItem[] {
  const seen = new Set<string>();
  const out: RequiredAuditItem[] = [];
  for (const item of items) {
    const key = `${normalizeTitle(item.title)}|${normalizeTitle(item.subjectName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * The board's "missing requirement" label.
 *
 * Suffixed with the subject when there is one — without it, three defensive
 * driver items read identically on the hand-off board and the producer cannot
 * tell which certificate is still outstanding.
 */
export function buildItemName(item: RequiredAuditItem): string {
  return item.subjectName ? `${item.title} — ${item.subjectName}` : item.title;
}

/**
 * `<dealId>|<title>|<subject>` — the idempotency key behind the partial-unique
 * index, so re-running generation for a deal creates nothing new.
 */
export function buildDedupeKey(
  dealId: string,
  item: RequiredAuditItem,
): string {
  return `${dealId}|${normalizeTitle(item.title)}|${normalizeTitle(item.subjectName)}`;
}
