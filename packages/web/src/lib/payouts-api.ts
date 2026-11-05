import type {
  PayoutActivityPeopleResponse,
  PayoutActivityView,
  PayoutRunResponse,
  PayStatementsResponse,
  PayStatementStatus,
  PayStatementView,
  PaymentStructureSummary,
  PaymentStructureView,
  PaymentStructuresResponse,
  PayoutPeopleResponse,
  PayoutSettingsView,
  UpdatePaymentStructureInput,
  UpdatePayoutSettingsInput,
  UpsertPaymentStructureInput,
} from "@sfa/shared";
import { apiFetch } from "@/lib/api-client";

/**
 * Payouts (PAC-176). PAC-177: the agency's payout settings and its payment
 * structures, both behind `agency:payouts:admin`. PAC-178/179: the monthly
 * runs, the statements and the activity behind them.
 */

export const payoutsKey = ["payouts"] as const;
export const payoutSettingsKey = [...payoutsKey, "settings"] as const;
export const paymentStructuresKey = [...payoutsKey, "structures"] as const;
export const payoutPeopleKey = [...paymentStructuresKey, "people"] as const;
export const paymentStructureKey = (id: string) =>
  [...paymentStructuresKey, id] as const;

/** Filters of `GET /payouts/statements`; `mine` is My Pay. */
export interface PayStatementsParams {
  month?: string;
  status?: PayStatementStatus;
  branchId?: string;
  q?: string;
  mine?: boolean;
  page?: number;
  pageSize?: number;
}

export const payoutRunsKey = [...payoutsKey, "runs"] as const;
export const payoutRunKey = (month: string) =>
  [...payoutRunsKey, month] as const;
export const payStatementsKey = [...payoutsKey, "statements"] as const;
export const payStatementsListKey = (params: PayStatementsParams) =>
  [...payStatementsKey, "list", params] as const;
export const payStatementKey = (id: string) =>
  [...payStatementsKey, "detail", id] as const;
export const payoutActivityKey = (userId: string, month: string) =>
  [...payoutsKey, "activity", userId, month] as const;
export const payoutActivityPeopleKey = [
  ...payoutsKey,
  "activity",
  "people",
] as const;

export function getPayoutSettings(): Promise<PayoutSettingsView> {
  return apiFetch<PayoutSettingsView>("/payouts/settings");
}

export function updatePayoutSettings(
  input: UpdatePayoutSettingsInput,
): Promise<PayoutSettingsView> {
  return apiFetch<PayoutSettingsView>("/payouts/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listPaymentStructures(): Promise<PaymentStructuresResponse> {
  return apiFetch<PaymentStructuresResponse>("/payouts/structures");
}

export function getPaymentStructure(id: string): Promise<PaymentStructureView> {
  return apiFetch<PaymentStructureView>(
    `/payouts/structures/${encodeURIComponent(id)}`,
  );
}

export function listPayoutPeople(): Promise<PayoutPeopleResponse> {
  return apiFetch<PayoutPeopleResponse>("/payouts/structures/people");
}

export function createPaymentStructure(
  input: UpsertPaymentStructureInput,
): Promise<PaymentStructureView> {
  return apiFetch<PaymentStructureView>("/payouts/structures", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * The whole structure, plus the `updatedAt` of the copy the editor loaded —
 * a 409 `PAYMENT_STRUCTURE_STALE` when it was saved elsewhere since.
 */
export function updatePaymentStructure(
  id: string,
  input: UpdatePaymentStructureInput,
): Promise<PaymentStructureView> {
  return apiFetch<PaymentStructureView>(
    `/payouts/structures/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function archivePaymentStructure(
  id: string,
): Promise<PaymentStructureSummary> {
  return apiFetch<PaymentStructureSummary>(
    `/payouts/structures/${encodeURIComponent(id)}/archive`,
    { method: "POST" },
  );
}

// ── Statements (PAC-178) ────────────────────────────────────────────────

/** The month's run, or `run: null` before one exists. `payouts:write`. */
export function getPayoutRun(month: string): Promise<PayoutRunResponse> {
  return apiFetch<PayoutRunResponse>(
    `/payouts/runs?month=${encodeURIComponent(month)}`,
  );
}

/**
 * Generate or recalculate a month — draft and disputed statements only. The
 * owner's (`agency:payouts:admin`); 409 `PAYOUT_RUN_GENERATING` while it is
 * already being computed.
 */
export function generatePayoutRun(month: string): Promise<PayoutRunResponse> {
  return apiFetch<PayoutRunResponse>("/payouts/runs", {
    method: "POST",
    body: JSON.stringify({ month }),
  });
}

export function listPayStatements(
  params: PayStatementsParams,
): Promise<PayStatementsResponse> {
  const search = new URLSearchParams();
  if (params.month) search.set("month", params.month);
  if (params.status) search.set("status", params.status);
  if (params.branchId) search.set("branchId", params.branchId);
  if (params.q) search.set("q", params.q);
  if (params.mine) search.set("mine", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.pageSize) search.set("pageSize", String(params.pageSize));
  const query = search.toString();
  return apiFetch<PayStatementsResponse>(
    `/payouts/statements${query ? `?${query}` : ""}`,
  );
}

export function getPayStatement(id: string): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}`,
  );
}

/** 409 `PAYOUT_STATEMENT_NOT_EDITABLE` once sent or accepted. */
export function recalculatePayStatement(id: string): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/recalculate`,
    { method: "POST" },
  );
}

// ── Activity (PAC-179) ──────────────────────────────────────────────────

/** One person's sales and chargebacks for a month; no `userId` = the caller. */
export function getPayoutActivity(params: {
  month: string;
  userId?: string;
}): Promise<PayoutActivityView> {
  const search = new URLSearchParams({ month: params.month });
  if (params.userId) search.set("userId", params.userId);
  return apiFetch<PayoutActivityView>(`/payouts/activity?${search.toString()}`);
}

/** Whose activity a reviewer may open. `payouts:write`. */
export function listPayoutActivityPeople(): Promise<PayoutActivityPeopleResponse> {
  return apiFetch<PayoutActivityPeopleResponse>("/payouts/activity/people");
}
