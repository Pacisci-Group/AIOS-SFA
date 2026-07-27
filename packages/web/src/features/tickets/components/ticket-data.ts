import type {
  ServiceTicketActivity,
  ServiceTicketCategory,
  ServiceTicketPriority,
  ServiceTicketStatus,
  ServiceTicketView,
} from "@sfa/shared";

/**
 * The ticket workspace now renders live data from the CRM Service API. These
 * aliases keep the component prop types stable while pointing at the shared
 * domain types (source of truth in `@sfa/shared`).
 */
export type Ticket = ServiceTicketView;
export type TimelineEntry = ServiceTicketActivity;
export type TicketStatus = ServiceTicketStatus;
export type TicketCategory = ServiceTicketCategory;
export type Priority = ServiceTicketPriority;
