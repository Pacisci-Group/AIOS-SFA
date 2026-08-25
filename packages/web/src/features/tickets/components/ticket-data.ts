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

/**
 * Presentation for each ticket status. Shared so the status picker looks and
 * behaves the same wherever it appears (ticket workspace header, service
 * dashboard queue rows).
 */
export const TICKET_STATUS_CONFIG: Record<
  TicketStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  open: {
    label: "Open",
    bg: "bg-[var(--kpi-blue-bg)]",
    text: "text-[var(--kpi-blue)]",
    dot: "bg-[var(--kpi-blue)]",
  },
  waiting: {
    label: "Waiting",
    bg: "bg-[var(--kpi-purple-bg)]",
    text: "text-[var(--kpi-purple)]",
    dot: "bg-[var(--kpi-purple)]",
  },
  resolved: {
    label: "Resolved",
    bg: "bg-[var(--kpi-green-bg)]",
    text: "text-[var(--kpi-green)]",
    dot: "bg-[var(--kpi-green)]",
  },
  overdue: {
    label: "Overdue",
    bg: "bg-[var(--kpi-amber-bg)]",
    text: "text-[var(--kpi-amber)]",
    dot: "bg-[var(--kpi-amber)]",
  },
  // Statuses a ticket can be opened with from the create form. They render
  // wherever a ticket is shown even though the status pickers don't offer them.
  in_progress: {
    label: "In Progress",
    bg: "bg-[var(--kpi-blue-bg)]",
    text: "text-[var(--kpi-blue)]",
    dot: "bg-[var(--kpi-blue)]",
  },
  waiting_on_client: {
    label: "Waiting on Client",
    bg: "bg-[var(--kpi-purple-bg)]",
    text: "text-[var(--kpi-purple)]",
    dot: "bg-[var(--kpi-purple)]",
  },
  waiting_on_carrier: {
    label: "Waiting on Carrier",
    bg: "bg-[var(--kpi-purple-bg)]",
    text: "text-[var(--kpi-purple)]",
    dot: "bg-[var(--kpi-purple)]",
  },
  closed: {
    label: "Closed",
    bg: "bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};
