import type {
  ActivateEmployeeInput,
  AddCalendarDaysInput,
  AddCalendarDaysResponse,
  AgencyCalendarDayView,
  AgencyCalendarView,
  ConfirmHolidayProposalInput,
  EmployeeListResponse,
  EmployeeProfileStatus,
  EmployeeProfileView,
  HolidayProposalView,
  HolidayRegionsResponse,
  HolidaySuggestionsResponse,
  HrPolicyView,
  LeavePoliciesResponse,
  LeavePolicyView,
  MyHrProfileView,
  SetEmployeeAssignmentInput,
  TerminateEmployeeInput,
  UpdateAgencyCalendarInput,
  UpdateEmployeeFactsInput,
  UpdateMyHrProfileInput,
  UpsertLeavePolicyInput,
  UpsertWorkScheduleTemplateInput,
  WorkScheduleTemplateView,
  WorkScheduleTemplatesResponse,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * The HR endpoints: the agency calendar, holiday suggestions and proposals,
 * leave policies and the HR Policy view (PAC-161); employee profiles, the
 * employee's own record and schedule templates (PAC-162).
 *
 * Reading the calendar and one's own profile is `hr:read` (every employee);
 * everything else is `agency:hr:admin`. Callers outside an admin's session
 * must tolerate a 403.
 */

export interface ListEmployeesParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: EmployeeProfileStatus[];
  branchId?: string;
  leavePolicyId?: string;
}

export const hrKeys = {
  calendar: (year: number) => ['hr', 'calendar', year] as const,
  regions: (country: string | null) => ['hr', 'regions', country] as const,
  policies: ['hr', 'leave-policies'] as const,
  policy: (id: string) => ['hr', 'leave-policies', id] as const,
  hrPolicy: ['hr', 'policy'] as const,
  employees: (params: ListEmployeesParams) => ['hr', 'employees', params] as const,
  employee: (userId: string) => ['hr', 'employees', 'one', userId] as const,
  myProfile: ['hr', 'me', 'profile'] as const,
  scheduleTemplates: ['hr', 'schedule-templates'] as const,
};

// ── Employee profiles (PAC-162) ─────────────────────────────────────────────

export function listEmployees(
  params: ListEmployeesParams,
): Promise<EmployeeListResponse> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.q) search.set('q', params.q);
  for (const status of params.status ?? []) search.append('status', status);
  if (params.branchId) search.set('branchId', params.branchId);
  if (params.leavePolicyId) search.set('leavePolicyId', params.leavePolicyId);
  const query = search.toString();
  return apiFetch<EmployeeListResponse>(`/hr/employees${query ? `?${query}` : ''}`);
}

export function getEmployee(userId: string): Promise<EmployeeProfileView> {
  return apiFetch<EmployeeProfileView>(`/hr/employees/${userId}`);
}

export function activateEmployee(
  userId: string,
  input: ActivateEmployeeInput,
): Promise<EmployeeProfileView> {
  return apiFetch<EmployeeProfileView>(`/hr/employees/${userId}/activate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function setEmployeeAssignment(
  userId: string,
  input: SetEmployeeAssignmentInput,
): Promise<EmployeeProfileView> {
  return apiFetch<EmployeeProfileView>(`/hr/employees/${userId}/assignment`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function updateEmployeeFacts(
  userId: string,
  input: UpdateEmployeeFactsInput,
): Promise<EmployeeProfileView> {
  return apiFetch<EmployeeProfileView>(`/hr/employees/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function terminateEmployee(
  userId: string,
  input: TerminateEmployeeInput,
): Promise<EmployeeProfileView> {
  return apiFetch<EmployeeProfileView>(`/hr/employees/${userId}/terminate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 404 when the caller has no profile yet; the card renders "not set up". */
export function getMyHrProfile(): Promise<MyHrProfileView> {
  return apiFetch<MyHrProfileView>('/hr/me/profile');
}

export function updateMyHrProfile(
  input: UpdateMyHrProfileInput,
): Promise<MyHrProfileView> {
  return apiFetch<MyHrProfileView>('/hr/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

// ── Schedule templates (PAC-162) ────────────────────────────────────────────

export function listScheduleTemplates(): Promise<WorkScheduleTemplatesResponse> {
  return apiFetch<WorkScheduleTemplatesResponse>('/hr/schedule-templates');
}

export function createScheduleTemplate(
  input: UpsertWorkScheduleTemplateInput & { name: string },
): Promise<WorkScheduleTemplateView> {
  return apiFetch<WorkScheduleTemplateView>('/hr/schedule-templates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateScheduleTemplate(
  id: string,
  input: UpsertWorkScheduleTemplateInput,
): Promise<WorkScheduleTemplateView> {
  return apiFetch<WorkScheduleTemplateView>(`/hr/schedule-templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveScheduleTemplate(
  id: string,
): Promise<WorkScheduleTemplateView> {
  return apiFetch<WorkScheduleTemplateView>(`/hr/schedule-templates/${id}/archive`, {
    method: 'POST',
  });
}

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

export function getHrPolicy(): Promise<HrPolicyView> {
  return apiFetch<HrPolicyView>('/hr/policy');
}

export function listLeavePolicies(): Promise<LeavePoliciesResponse> {
  return apiFetch<LeavePoliciesResponse>('/hr/leave-policies');
}

export function getLeavePolicy(id: string): Promise<LeavePolicyView> {
  return apiFetch<LeavePolicyView>(`/hr/leave-policies/${id}`);
}

export function createLeavePolicy(
  input: UpsertLeavePolicyInput & { name: string },
): Promise<LeavePolicyView> {
  return apiFetch<LeavePolicyView>('/hr/leave-policies', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateLeavePolicy(
  id: string,
  input: UpsertLeavePolicyInput,
): Promise<LeavePolicyView> {
  return apiFetch<LeavePolicyView>(`/hr/leave-policies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveLeavePolicy(id: string): Promise<LeavePolicyView> {
  return apiFetch<LeavePolicyView>(`/hr/leave-policies/${id}/archive`, {
    method: 'POST',
  });
}
