/**
 * Shared domain vocabulary for the CRM Service tickets module. Kept in
 * `@sfa/shared` so the API (schema/DTO validation) and the web app (typed API
 * client + UI) agree on the exact set of allowed values.
 */

export const SERVICE_TICKET_STATUSES = [
  'open',
  'waiting',
  'resolved',
  'overdue',
] as const;
export type ServiceTicketStatus = (typeof SERVICE_TICKET_STATUSES)[number];

export const SERVICE_TICKET_CATEGORIES = [
  'Renewal Review',
  'Claims Inquiry',
  'Premium Dispute',
  'Policy Change',
  'Billing Issue',
  'Coverage Question',
  'Cancellation Request',
  'New Business',
] as const;
export type ServiceTicketCategory = (typeof SERVICE_TICKET_CATEGORIES)[number];

export const SERVICE_TICKET_PRIORITIES = ['high', 'medium', 'low'] as const;
export type ServiceTicketPriority = (typeof SERVICE_TICKET_PRIORITIES)[number];

export const SERVICE_TICKET_ACTIVITY_TYPES = [
  'created',
  'note',
  'status',
  'system',
  'call',
  'email',
] as const;
export type ServiceTicketActivityType =
  (typeof SERVICE_TICKET_ACTIVITY_TYPES)[number];

/**
 * The subset of activity types a user can log manually from the ticket detail
 * view (an internal note, a phone call, or an email touchpoint).
 */
export const SERVICE_TICKET_NOTE_TYPES = ['note', 'call', 'email'] as const;
export type ServiceTicketNoteType = (typeof SERVICE_TICKET_NOTE_TYPES)[number];

export interface ServiceTicketActivity {
  id: string;
  type: ServiceTicketActivityType;
  author?: string;
  content: string;
  /** ISO timestamp of when the activity was recorded. */
  at: string;
  /** Human-friendly timestamp label for display (e.g. "Jun 9, 2026 — 9:14 AM"). */
  timestamp: string;
}

/**
 * The serialized service-ticket shape returned by the API and consumed by the
 * web app. Field names mirror the original mock UI so components need minimal
 * changes.
 */
export interface ServiceTicketView {
  id: string;
  ticketNumber: string;
  clientName: string;
  category: ServiceTicketCategory;
  status: ServiceTicketStatus;
  priority: ServiceTicketPriority;
  assignedRep: string;
  assignedUserId: string | null;
  policyNumber: string;
  policyType: string;
  household: string;
  phone: string;
  email: string;
  /** Whole days since the ticket was opened. */
  daysOpen: number;
  /** Relative label for the last activity (e.g. "2 hours ago"). */
  lastActivity: string;
  openedAt: string;
  lastActivityAt: string;
  timeline: ServiceTicketActivity[];
}

export interface ServiceTicketStats {
  openTickets: number;
  needsActionToday: number;
  upcomingRenewals: number;
  premiumIncreases: number;
  resolvedToday: number;
  dailyTarget: number;
  totalHouseholds: number;
  avgLobDensity: number;
}
