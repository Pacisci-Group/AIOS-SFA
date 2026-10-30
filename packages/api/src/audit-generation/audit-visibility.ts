import { CORE_AUDIT_TEMPLATES } from '../seed/audit-templates.seed';
import { normalizeTitle } from './audit-titles';

/** Who sees an item, and whether it needs a file (PAC-106 §3). */
export interface AuditItemFlags {
  producerVisible: boolean;
  requiresUpload: boolean;
}

/**
 * Item names the SmartSuite import writes that are not a core template's name
 * (`DEAL_AUDIT_ITEM_NAME_LABELS` in `migration/smartsuite/field-ids.ts`):
 * legacy kept one item per discount, without the Home / Landlord prefix the
 * generator synthesises. Each takes its Home template's flags — the Landlord
 * variant has the same ones.
 */
const LEGACY_ALIASES: Record<string, string> = {
  'fire subscription': 'Home Fire Subscription',
  'actual cash value': 'Home Actual Cash Value',
  'hail resistant roof': 'Home Hail Resistant Roof',
  '(mortgagee) escrow payment': 'Home Mortgagee',
};

/**
 * Drivewise was retired by PAC-65 ("there is no document that could prove
 * enrolment") and generates nothing, but migrated deals still carry the item.
 * There is nothing the producer can provide, so it is the manager's to pass
 * with a note — the strict Approve gate leaves no other way to clear it.
 */
const RETIRED_MANAGER_ONLY = new Set(['drivewise']);

const BY_NAME = new Map<string, AuditItemFlags>(
  CORE_AUDIT_TEMPLATES.map((template) => [
    normalizeTitle(template.name),
    {
      producerVisible: template.producerVisible,
      requiresUpload: template.requiresUpload,
    },
  ]),
);

/** A template an agency added itself: visible, no file — the schema default. */
const DEFAULT_FLAGS: AuditItemFlags = {
  producerVisible: true,
  requiresUpload: false,
};

/**
 * The flags for an item known only by its name — what the SmartSuite import
 * has, since migrated items carry no `templateId`.
 *
 * `itemName` may carry a subject suffix (`Defensive Driver — Sam`, see
 * `buildItemName`); it is stripped before matching. App-generated items never
 * come through here: `AuditGenerationService` copies the flags off the
 * template it resolved.
 *
 * ⚠ The `audit_item_review_flags_and_producer_counters` migration carries a
 * copy of this table (migrations import nothing). Change both or neither.
 */
export function auditItemFlagsForName(
  itemName: string | null | undefined,
): AuditItemFlags {
  const title = normalizeTitle((itemName ?? '').split(' — ')[0]);
  if (RETIRED_MANAGER_ONLY.has(title)) {
    return { producerVisible: false, requiresUpload: false };
  }
  const alias = LEGACY_ALIASES[title];
  return BY_NAME.get(alias ? normalizeTitle(alias) : title) ?? DEFAULT_FLAGS;
}
