import {
  parseLegacyTicketNumber,
  toServiceTicketCategory,
  toServiceTicketPriority,
  toServiceTicketStatus,
} from '@sfa/shared';
import { Types } from 'mongoose';

/**
 * Turns a legacy service-ticket row into the fields the live `ServiceTicket`
 * schema stores.
 *
 * Two callers, one shape. The SmartSuite migration feeds this straight from a
 * table record; `consolidate-service-tickets.ts` fed it from the rows an
 * earlier migration had written as a thin mirror of that table. Both must land
 * on a document indistinguishable from one the CRM opened itself — same
 * numbering rule, same status vocabulary, same opening timeline entry — which
 * is why the assembly lives here rather than in either caller.
 *
 * Pure and synchronous. The caller resolves the linked household, policy and
 * users first (`LegacyTicketLinks`), because how those are looked up differs
 * between the two and neither belongs in a unit-testable mapper.
 */

/** What the legacy row says, already extracted to plain values. */
export interface LegacyTicketSource {
  /** The SmartSuite record title — `#SFAS-030` — which becomes the number. */
  title?: string;
  category?: string;
  /** Code, label or slug; every form is accepted. */
  status?: string;
  priority?: string;
  clientName?: string;
  /** The assigned CRM's display name. */
  crmName?: string;
  /** The creator's display name, when the source carries one. */
  createdByName?: string;
  /** Ticket body, plain text. Becomes the opening timeline entry. */
  notes?: string;
  createdDate?: Date;
  /** Last touch on the source side; `lastActivityAt` when present. */
  lastUpdated?: Date;
  dateResolved?: Date;
  policyId?: Types.ObjectId;
  householdId?: Types.ObjectId;
  assignedUserId?: Types.ObjectId;
  createdByUserId?: Types.ObjectId;
  isTestRecord: boolean;
}

/** Display fields off the linked records, resolved by the caller. */
export interface LegacyTicketLinks {
  household?: {
    name?: string | null;
    primaryContactName?: string | null;
    primaryPhones?: string[];
    primaryEmails?: string[];
  } | null;
  policy?: {
    policyNumber?: string | null;
    policyType?: string | null;
  } | null;
  /** The creator's name from the `users` collection, for rows without one. */
  createdByDisplayName?: string | null;
}

/**
 * The stored fields, or `null` when the title is not a ticket number.
 *
 * Null rather than a made-up number: `ticketNumber` is required and unique per
 * agency, and inventing one here would either collide with the CRM's allocator
 * or hand the agency a number that matches nothing on their paper. The caller
 * reports the row and moves on.
 */
export function buildLegacyTicket(
  source: LegacyTicketSource,
  links: LegacyTicketLinks = {},
  now: Date = new Date(),
): Record<string, unknown> | null {
  const ticketNumber = parseLegacyTicketNumber(source.title);
  if (!ticketNumber) return null;

  const household = links.household ?? null;
  const policy = links.policy ?? null;
  const category = toServiceTicketCategory(source.category);
  const status = toServiceTicketStatus(source.status);
  const openedAt = source.createdDate ?? now;
  const resolvedAt = source.dateResolved ?? null;
  // Same chain `ServiceTicketsService.create` walks when the dialog leaves the
  // name blank — three of the 286 legacy rows do.
  const clientName =
    source.clientName?.trim() ||
    household?.primaryContactName?.trim() ||
    household?.name?.trim() ||
    'Unnamed client';
  const createdByName =
    source.createdByName?.trim() ||
    links.createdByDisplayName?.trim() ||
    source.crmName?.trim() ||
    '';
  const notes = source.notes?.trim();

  return {
    ticketNumber,
    clientName,
    category,
    status,
    /*
     * A legacy `Onboarding` ticket is a single row, not a step in the chain
     * the CRM builds, so it has no `onboarding` payload for the schedule to
     * derive a status from. Marking it overridden makes the stored status
     * authoritative — the same switch a CSR flips from the status picker — so
     * the queue filters find it under the status it actually holds.
     */
    statusOverriddenAt: category === 'Onboarding' ? openedAt : null,
    priority: toServiceTicketPriority(source.priority),
    assignedRep: source.crmName?.trim() ?? '',
    assignedUserId: source.assignedUserId ?? null,
    createdByUserId: source.createdByUserId ?? null,
    createdByName,
    policyNumber: policy?.policyNumber?.trim() ?? '',
    policyType: policy?.policyType?.trim() ?? '',
    household: household?.name?.trim() ?? '',
    policyId: source.policyId ?? null,
    householdId: source.householdId ?? null,
    leadId: null,
    phone: household?.primaryPhones?.[0] ?? '',
    email: household?.primaryEmails?.[0] ?? '',
    openedAt,
    // The archive window reads `resolvedAt ?? lastActivityAt`, so a closed
    // ticket whose source never recorded a resolve date still ages out on its
    // last touch rather than sitting in the Resolved tab forever.
    lastActivityAt: source.lastUpdated ?? resolvedAt ?? openedAt,
    resolvedAt,
    timeline: [
      {
        type: 'created',
        ...(createdByName ? { author: createdByName } : {}),
        // Mirrors `create()`: the body when there is one, else the same
        // one-liner the app writes for a ticket opened without a note.
        content: notes || `Ticket opened — ${category}.`,
        at: openedAt,
      },
    ],
    onboarding: null,
    renewal: null,
    isTestRecord: source.isTestRecord,
  };
}
