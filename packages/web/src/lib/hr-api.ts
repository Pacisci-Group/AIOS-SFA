import type {
  AddCalendarDaysInput,
  AddCalendarDaysResponse,
  AgencyCalendarDayView,
  AgencyCalendarView,
  ConfirmHolidayProposalInput,
  HolidayProposalView,
  HolidayRegionsResponse,
  HolidaySuggestionsResponse,
  UpdateAgencyCalendarInput,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * The HR foundation's endpoints (PAC-161): the agency calendar, holiday
 * suggestions and the Q4 next-year proposals.
 *
 * Reading the calendar is `hr:read` (every employee); everything else is
 * `agency:hr:admin`. Callers outside an admin's session must tolerate a 403.
 */

export const hrKeys = {
  calendar: (year: number) => ['hr', 'calendar', year] as const,
  regions: (country: string | null) => ['hr', 'regions', country] as const,
};

export function getAgencyCalendar(year: number): Promise<AgencyCalendarView> {
  return apiFetch<AgencyCalendarView>(`/hr/calendar?year=${year}`);
}

export function updateAgencyCalendar(
  input: UpdateAgencyCalendarInput,
): Promise<AgencyCalendarView> {
  return apiFetch<AgencyCalendarView>('/hr/calendar', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getHolidayRegions(
  country: string | null,
): Promise<HolidayRegionsResponse> {
  const query = country ? `?country=${encodeURIComponent(country)}` : '';
  return apiFetch<HolidayRegionsResponse>(`/hr/calendar/holiday-regions${query}`);
}

export function getHolidaySuggestions(input: {
  country: string;
  region: string | null;
  year: number;
}): Promise<HolidaySuggestionsResponse> {
  const params = new URLSearchParams({
    country: input.country,
    year: String(input.year),
  });
  if (input.region) params.set('region', input.region);
  return apiFetch<HolidaySuggestionsResponse>(
    `/hr/calendar/holiday-suggestions?${params.toString()}`,
  );
}

export function addCalendarDays(
  input: AddCalendarDaysInput,
): Promise<AddCalendarDaysResponse> {
  return apiFetch<AddCalendarDaysResponse>('/hr/calendar/days', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeCalendarDay(
  id: string,
  reason: string,
): Promise<AgencyCalendarDayView> {
  return apiFetch<AgencyCalendarDayView>(`/hr/calendar/days/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

export function confirmHolidayProposal(
  year: number,
  input: ConfirmHolidayProposalInput,
): Promise<HolidayProposalView> {
  return apiFetch<HolidayProposalView>(
    `/hr/calendar/proposals/${year}/confirm`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function dismissHolidayProposal(
  year: number,
): Promise<HolidayProposalView> {
  return apiFetch<HolidayProposalView>(
    `/hr/calendar/proposals/${year}/dismiss`,
    { method: 'POST' },
  );
}
