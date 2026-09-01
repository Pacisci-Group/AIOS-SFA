import { choiceVocabulary } from './choice-vocabulary';
import {
  SERVICE_TICKET_CATEGORIES,
  type ServiceTicketCategory,
} from '../service/service-ticket';

/**
 * The imported `serviceTickets` collection's own choice vocabulary (PAC-80).
 *
 * ## ⚠ There are two ServiceTicket schemas. This is for the other one.
 *
 * | | collection | schema | vocabulary |
 * |---|---|---|---|
 * | Live CRM | `service_tickets` | `crm/schemas/service-ticket.schema.ts` | `SERVICE_TICKET_STATUSES`, lowercase snake_case, **enum-enforced** |
 * | SmartSuite import | `serviceTickets` | `service-tickets/schemas/service-ticket.schema.ts` | this file, display labels, free strings |
 *
 * Two schemas whose classes are both named `ServiceTicket` and differ only by
 * collection name is a standing trap, so be explicit about which one is in hand.
 * Applying `SERVICE_TICKET_STATUSES` to the imported collection would be wrong in
 * both directions: its values are snake_case slugs for a different lifecycle, and
 * the imported rows are free strings that no enum validates.
 *
 * **Storing display labels here is a deliberate choice.** Nothing reads this
 * collection today — it has no controller and no service — so the only consumer
 * is a human looking at Mongo, for whom "Waiting on Carrier" beats `a2E7K`. If
 * these rows are ever folded into the live CRM collection, that migration will
 * need to map labels onto the snake_case enum; a rename either way, and worth
 * less than the readability now.
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
