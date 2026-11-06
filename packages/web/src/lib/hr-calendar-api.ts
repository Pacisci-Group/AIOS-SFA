import type {
  AgencyEventAudienceOptions,
  AgencyEventImpact,
  AgencyEventInput,
  AgencyEventView,
  HrCalendarFilters,
  HrCalendarResponse,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * The HR calendar and the agency's events (PAC-169). Shapes and rules are
 * in `@sfa/shared` (`hr-calendar.ts`, `agency-event.ts`); the endpoints are
 * documented in `bruno/HR Calendar/`.
 */

export interface HrCalendarParams {
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  branchId?: string[];
  employeeId?: string[];
}

export const hrCalendarKeys = {
  /** Invalidate after an event is saved or removed, or a request changes. */
  all: ['hr-calendar'] as const,
  range: (params: HrCalendarParams) => ['hr-calendar', 'range', params] as const,
  filters: ['hr-calendar', 'filters'] as const,
  event: (eventId: string) => ['hr-calendar', 'event', eventId] as const,
  audienceOptions: ['hr-calendar', 'audience-options'] as const,
  impact: (input: unknown) => ['hr-calendar', 'impact', input] as const,
};

function query(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((entry) => search.append(key, String(entry)));
    else search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** `hr:read`. Scoped by the server: see the docs on `Get HR Calendar`. */
export function getHrCalendar(params: HrCalendarParams): Promise<HrCalendarResponse> {
  return apiFetch<HrCalendarResponse>(`/hr/calendar${query(params)}`);
}

/** Empty lists for someone who sees only their own time off. */
export function getHrCalendarFilters(): Promise<HrCalendarFilters> {
  return apiFetch<HrCalendarFilters>('/hr/calendar/filters');
}

// ── Events (`agency:hr:admin`) ───────────────────────────────────────────

export interface SavedAgencyEvent {
  event: AgencyEventView;
  impact: AgencyEventImpact;
}

export function getAgencyEvent(eventId: string): Promise<AgencyEventView> {
  return apiFetch<AgencyEventView>(`/hr/events/${eventId}`);
}

export function listEventAudienceOptions(): Promise<AgencyEventAudienceOptions> {
  return apiFetch<AgencyEventAudienceOptions>('/hr/events/audience-options');
}

/** Writes nothing: the live requests the event would run into. */
export function previewAgencyEventImpact(input: AgencyEventInput): Promise<AgencyEventImpact> {
  return apiFetch<AgencyEventImpact>('/hr/events/impact', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createAgencyEvent(input: AgencyEventInput): Promise<SavedAgencyEvent> {
  return apiFetch<SavedAgencyEvent>('/hr/events', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** The whole event, as the form holds it. */
export function updateAgencyEvent(
  eventId: string,
  input: AgencyEventInput,
): Promise<SavedAgencyEvent> {
  return apiFetch<SavedAgencyEvent>(`/hr/events/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function removeAgencyEvent(eventId: string): Promise<void> {
  return apiFetch<void>(`/hr/events/${eventId}`, { method: 'DELETE' });
}
