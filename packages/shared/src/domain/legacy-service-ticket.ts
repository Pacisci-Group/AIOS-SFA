import { choiceVocabulary } from './choice-vocabulary';
import {
  SERVICE_TICKET_CATEGORIES,
  type ServiceTicketCategory,
  type ServiceTicketPriority,
  type ServiceTicketStatus,
} from '../service/service-ticket';

/**
 * SmartSuite "The Service Tickets Table" choice vocabulary, and its bridge onto
 * the live `ServiceTicket` enums (PAC-80).
 *
 * Two steps, deliberately kept apart:
 *
 * 1. **Decode** — SmartSuite's opaque choice codes (`a2E7K`) to the label the
 *    agency saw on screen ("Waiting on Carrier"). `normalizeLegacyTicketStatus`
 *    and `normalizeLegacyTicketCategory` do this and are idempotent over labels.
 * 2. **Bridge** — the label to the snake_case slug the CRM stores and
 *    enum-enforces (`waiting_on_carrier`). `toServiceTicketStatus` and
 *    `toServiceTicketPriority` do this.
 *
 * Both steps are needed because two sources feed the bridge: the migration
 * decodes codes straight off SmartSuite, while the one-off consolidation
 * (`consolidate-service-tickets.ts`) reshaped rows that had already been
 * decoded to labels by an earlier import. Keeping the decode idempotent is what
 * lets both paths call the same function and land on the same slug.
 *
 * Categories need no bridge: SmartSuite's labels *are* the CRM's category
 * enum, member for member — `satisfies` on the alias table is what keeps it so.
 */

/**
 * `docs/smartsuite-tables/The Service Tickets Table.md:18` — field `category`.
 *
 * Only the six opaque codes need entries: SmartSuite uses the label as its own
 * code for the other six (`Onboarding`, `Billing`, …), which resolve through the
 * case-insensitive label lookup. That is why 126 of 286 migrated rows held a
 * code and the rest already read correctly.
 *
 * `satisfies` is load-bearing — every target label is already a member of
 * `SERVICE_TICKET_CATEGORIES`, and the compiler is what keeps the two agreeing.
 */
export const LEGACY_TICKET_CATEGORY_CODE_ALIASES = {
  '4osEm': 'Policy Change',
  Nr2xm: 'Payment',
  '0E0RC': 'Company Transfer',
  sKLrt: 'Save',
  fieTl: 'Termination',
  Q3ktu: 'Renewal Taken',
} satisfies Record<string, ServiceTicketCategory>;

const categoryVocabulary = choiceVocabulary(
  SERVICE_TICKET_CATEGORIES,
  LEGACY_TICKET_CATEGORY_CODE_ALIASES,
);

export const normalizeLegacyTicketCategory = categoryVocabulary.normalize;

/**
 * A legacy category as a `ServiceTicketCategory`, or `Other` when it is not
 * one. `Other` rather than passthrough because the CRM schema enum-enforces the
 * field: an unrecognised label would fail validation on the first edit, and a
 * ticket the CSR cannot save is worse than one filed under the catch-all.
 */
export function toServiceTicketCategory(
  raw?: string | null,
): ServiceTicketCategory {
  const label = normalizeLegacyTicketCategory(raw);
  return categoryVocabulary.isCanonical(label)
    ? (label as ServiceTicketCategory)
    : 'Other';
}

/**
 * `The Service Tickets Table.md:28` — field `s7afd05edc`, a SmartSuite *status*
 * field, so four of six codes are generic workflow slugs.
 *
 * Those slugs are not globally meaningful: `backlog` is "Open" here, "Not
 * Started" on Prior Policies, and "Submitted" on Time Off Requests. One map per
 * field is the only thing that keeps those apart.
 */
export const LEGACY_TICKET_STATUSES = [
  'Open',
  'In Progress',
  'Waiting on Client',
  'Waiting on Carrier',
  'Resolved',
  'Closed',
] as const;

export type LegacyTicketStatus = (typeof LEGACY_TICKET_STATUSES)[number];

export const LEGACY_TICKET_STATUS_CODE_ALIASES: Record<
  string,
  LegacyTicketStatus
> = {
  backlog: 'Open',
  in_progress: 'In Progress',
  ready_for_review: 'Waiting on Client',
  a2E7K: 'Waiting on Carrier',
  complete: 'Resolved',
  r1Glf: 'Closed',
};

const statusVocabulary = choiceVocabulary(
  LEGACY_TICKET_STATUSES,
  LEGACY_TICKET_STATUS_CODE_ALIASES,
);

export const normalizeLegacyTicketStatus = statusVocabulary.normalize;

/**
 * Label → the slug the CRM stores. Every legacy label has a slug, and every
 * slug here is a real `ServiceTicketStatus` — both checked by the compiler.
 */
export const LEGACY_TICKET_STATUS_SLUGS = {
  Open: 'open',
  'In Progress': 'in_progress',
  'Waiting on Client': 'waiting_on_client',
  'Waiting on Carrier': 'waiting_on_carrier',
  Resolved: 'resolved',
  Closed: 'closed',
} as const satisfies Record<LegacyTicketStatus, ServiceTicketStatus>;

/**
 * A legacy status — code, label, or already a slug — as a `ServiceTicketStatus`.
 *
 * Blank falls to `open`: five of the 286 migrated tickets carried no status at
 * all, and a ticket nobody closed is open. Anything unrecognised also falls to
 * `open` rather than through, for the same reason categories fall to `Other`.
 */
export function toServiceTicketStatus(raw?: string | null): ServiceTicketStatus {
  const value = (raw ?? '').trim();
  if (!value) return 'open';
  // Already a slug — the consolidation re-run over healed data hits this.
  const slugs = Object.values(LEGACY_TICKET_STATUS_SLUGS) as string[];
  if (slugs.includes(value)) return value as ServiceTicketStatus;
  const label = normalizeLegacyTicketStatus(value) as LegacyTicketStatus;
  return LEGACY_TICKET_STATUS_SLUGS[label] ?? 'open';
}

/**
 * `The Service Tickets Table.md:19` — field `priority`, whose codes are its
 * labels. `Urgent` collapses onto `high`: the CRM has three levels, and the
 * queue's urgency sort already ranks by status and age before priority, so a
 * fourth rung would change nothing a CSR can see.
 */
export const LEGACY_TICKET_PRIORITIES = [
  'Low',
  'Medium',
  'High',
  'Urgent',
] as const;

export type LegacyTicketPriority = (typeof LEGACY_TICKET_PRIORITIES)[number];

export const LEGACY_TICKET_PRIORITY_SLUGS = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Urgent: 'high',
} as const satisfies Record<LegacyTicketPriority, ServiceTicketPriority>;

const priorityVocabulary = choiceVocabulary(LEGACY_TICKET_PRIORITIES);

/** Blank and unrecognised both fall to the CRM's own default, `medium`. */
export function toServiceTicketPriority(
  raw?: string | null,
): ServiceTicketPriority {
  const value = (raw ?? '').trim();
  if (!value) return 'medium';
  const slugs = Object.values(LEGACY_TICKET_PRIORITY_SLUGS) as string[];
  if (slugs.includes(value)) return value as ServiceTicketPriority;
  const label = priorityVocabulary.normalize(value) as LegacyTicketPriority;
  return LEGACY_TICKET_PRIORITY_SLUGS[label] ?? 'medium';
}
