import type {
  BalanceAdjustmentInput,
  BalanceAdjustmentResult,
  CreateTimeOffRequestInput,
  PreviewTimeOffRequestInput,
  RecordablePersonView,
  RecordTimeOffInput,
  TeamTimeOffRequestGroup,
  TimeOffCheckCode,
  TimeOffPreview,
  TimeOffRequestGroup,
  TimeOffRequestInput,
  TimeOffRequestList,
  TimeOffRequestView,
  TimeOffSummary,
} from '@sfa/shared';
import { ApiError, apiFetch } from '@/lib/api-client';

/**
 * Time off (PAC-165): the Time off page's reads and writes.
 *
 * Two audiences on one surface. An employee (`hr:read`) reads their own
 * cards and requests and makes, edits, sends and cancels them. A reviewer
 * (`hr:write`) reads the requests of the people in their data scope and
 * decides them; with `agency:users:read` as well they record time off for
 * someone else. The server decides which the caller is on each request and
 * returns `actions[]` — the page renders those rather than re-deriving them.
 */

export interface MyTimeOffRequestsParams {
  group?: TimeOffRequestGroup[];
  page?: number;
  pageSize?: number;
}

export interface TeamTimeOffRequestsParams {
  group?: TeamTimeOffRequestGroup[];
  q?: string;
  policyId?: string;
  employeeId?: string;
  page?: number;
  pageSize?: number;
}

export const timeOffKeys = {
  /** Invalidate after any write: cards, lists and open requests all move. */
  all: ['time-off'] as const,
  summary: ['time-off', 'summary'] as const,
  mine: (params: MyTimeOffRequestsParams) => ['time-off', 'mine', params] as const,
  team: (params: TeamTimeOffRequestsParams) => ['time-off', 'team', params] as const,
  request: (requestId: string) => ['time-off', 'request', requestId] as const,
  preview: (kind: 'self' | 'record', input: unknown) =>
    ['time-off', 'preview', kind, input] as const,
  recordablePeople: ['time-off', 'recordable-people'] as const,
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

const post = <T>(path: string, body: unknown = {}) =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** The caller's cards: a balance per time off policy they are in. */
export function getTimeOffSummary(): Promise<TimeOffSummary> {
  return apiFetch<TimeOffSummary>('/time-off/summary');
}

export function listMyTimeOffRequests(
  params: MyTimeOffRequestsParams = {},
): Promise<TimeOffRequestList> {
  return apiFetch<TimeOffRequestList>(`/time-off/requests/mine${query(params)}`);
}

/** The requests of the people the caller reviews; To review by default. */
export function listTeamTimeOffRequests(
  params: TeamTimeOffRequestsParams = {},
): Promise<TimeOffRequestList> {
  return apiFetch<TimeOffRequestList>(`/time-off/requests${query(params)}`);
}

export function getTimeOffRequest(requestId: string): Promise<TimeOffRequestView> {
  return apiFetch<TimeOffRequestView>(`/time-off/requests/${requestId}`);
}

/** Hours per date, the balance lines and the blockers. Writes nothing. */
export function previewTimeOffRequest(
  input: PreviewTimeOffRequestInput,
): Promise<TimeOffPreview> {
  return post<TimeOffPreview>('/time-off/requests/preview', input);
}

/** `send: false` saves a Draft; `send: true` sends it for review. */
export function createTimeOffRequest(
  input: CreateTimeOffRequestInput,
): Promise<TimeOffRequestView> {
  return post<TimeOffRequestView>('/time-off/requests', input);
}

/** Edit the caller's Draft, or their request sent back for changes. */
export function updateTimeOffRequest(
  requestId: string,
  input: TimeOffRequestInput,
): Promise<TimeOffRequestView> {
  return apiFetch<TimeOffRequestView>(`/time-off/requests/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Send, or resend after changes — with the edited form, or as saved. */
export function submitTimeOffRequest(
  requestId: string,
  input?: TimeOffRequestInput,
): Promise<TimeOffRequestView> {
  return post<TimeOffRequestView>(`/time-off/requests/${requestId}/submit`, input ?? {});
}

/** Discard the caller's Draft (a soft delete). */
export function discardTimeOffRequest(requestId: string): Promise<void> {
  return apiFetch<void>(`/time-off/requests/${requestId}`, { method: 'DELETE' });
}

export type TimeOffDecision = 'approve' | 'request-changes' | 'decline' | 'cancel';

/** A reviewer's decision, or a cancellation by either side. */
export function decideTimeOffRequest(
  requestId: string,
  decision: TimeOffDecision,
  note?: string | null,
): Promise<TimeOffRequestView> {
  return post<TimeOffRequestView>(`/time-off/requests/${requestId}/${decision}`, {
    note: note?.trim() ? note.trim() : null,
  });
}

/** The people the caller may record time off for, with their policies. */
export function listRecordablePeople(): Promise<RecordablePersonView[]> {
  return apiFetch<RecordablePersonView[]>('/time-off/recordable-people');
}

export function previewRecordedTimeOff(input: RecordTimeOffInput): Promise<TimeOffPreview> {
  return post<TimeOffPreview>('/time-off/records/preview', input);
}

/** Time off recorded for someone else: created already Approved. */
export function recordTimeOff(input: RecordTimeOffInput): Promise<TimeOffRequestView> {
  return post<TimeOffRequestView>('/time-off/records', input);
}

/** An HR admin's signed correction to one person's balance in one policy. */
export function adjustTimeOffBalance(
  userId: string,
  input: BalanceAdjustmentInput,
): Promise<BalanceAdjustmentResult> {
  return post<BalanceAdjustmentResult>(`/hr/people/${userId}/balance-adjustments`, input);
}

interface RefusalBody {
  code?: TimeOffCheckCode;
  request?: TimeOffRequestView;
}

function refusalBody(error: unknown): RefusalBody | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== 'object') {
    return null;
  }
  return error.body as RefusalBody;
}

/** The `code` of a structured refusal — never match the message. */
export function timeOffRefusalCode(error: unknown): TimeOffCheckCode | null {
  return refusalBody(error)?.code ?? null;
}

/**
 * The record as it now stands, which a `409 already_decided` carries: the
 * request somebody else decided while this window was open.
 */
export function timeOffRefusalRequest(error: unknown): TimeOffRequestView | null {
  return refusalBody(error)?.request ?? null;
}
