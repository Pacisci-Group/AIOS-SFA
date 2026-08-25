import type { ActivityType } from './activity';
import type { LeadTemperature } from './lead-temperature';

/**
 * The Hot Leads / Priority Contact List on the Producer Dashboard (PAC-15).
 *
 * A *priority contact* list, not a recently-touched list: rows are ordered
 * stalest-first, which is the inverse of the Leads page. The lead you last
 * spoke to is the one who least needs a call.
 */
export interface HotLeadRow {
  id: string;
  name: string;
  /** Derived from the name, so the row can render an avatar without a lookup. */
  initials: string;
  temperature: LeadTemperature;
  /** Normalized label, never a raw choice code. */
  leadSource: string;
  /** Canonical status label. */
  status: string;
  phone: string | null;
  email: string | null;
  /**
   * The narrative line: the most recent activity's summary.
   *
   * A mix of system-generated events (`lead_created`, `quoted`, `sold`) and
   * producer-written notes and call logs. `null` when the lead has no activity
   * at all — the UI falls back to the status rather than inventing copy.
   */
  lastActivitySummary: string | null;
  lastActivityType: ActivityType | null;
  lastActivityAt: string | null;
}

/**
 * Deliberately **not** the `{page, pageSize, total, totalPages, items}`
 * envelope every list endpoint uses. This is a fixed-size dashboard panel with
 * no page controls, and shipping page arithmetic would advertise pagination
 * that does not exist.
 */
export interface HotLeadListResponse {
  items: HotLeadRow[];
}
