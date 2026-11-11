import type {
  AcceptPayStatementInput,
  AddStatementAdjustmentInput,
  ChargebackImportCommitResponse,
  ChargebackImportPresignResponse,
  ChargebackImportsResponse,
  ChargebackImportSummary,
  ChargebackImportView,
  ImportPeopleResponse,
  ImportRowAction,
  UpdateImportRowResponse,
  PayoutActivityPeopleResponse,
  PayoutActivityView,
  PayoutRunResponse,
  PayStatementPdfLinkResponse,
  PayStatementsResponse,
  PayStatementStatus,
  PayStatementView,
  SendAllDraftsResponse,
  PaymentStructureSummary,
  PaymentStructureView,
  PaymentStructuresResponse,
  PayoutPeopleResponse,
  PayoutSettingsView,
  RejectPayStatementInput,
  StatementPdfVariant,
  UpdatePaymentStructureInput,
  UpdatePayoutSettingsInput,
  UpdateStatementAdjustmentsInput,
  UpdateStatementInputsInput,
  UpsertPaymentStructureInput,
} from "@sfa/shared";
import { apiFetch, apiFetchBlob } from "@/lib/api-client";
import { uploadToPresignedUrl } from "@/lib/presigned-upload";

/**
 * Payouts (PAC-176). PAC-177: the agency's payout settings and its payment
 * structures, both behind `agency:payouts:admin`. PAC-178/179: the monthly
 * runs, the statements and the activity behind them. PAC-180: the carrier
 * chargeback report import (admin). PAC-181: the Commission Statement PDF,
 * sending and reopening. PAC-182: the employee's answer (accept with a
 * signature, or dispute) and the reviewer's chargeback lines.
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
/**
 * Every statements list (the Payouts table, My Pay). A statement action
 * replaces the detail it returns and refreshes these — not the detail's own
 * PDF link or preview, which belong to the version on screen.
 */
export const payStatementListsKey = [...payStatementsKey, "list"] as const;
export const payStatementsListKey = (params: PayStatementsParams) =>
  [...payStatementListsKey, params] as const;
export const payStatementKey = (id: string) =>
  [...payStatementsKey, "detail", id] as const;
/**
 * One version's link — the issued file, or the signed copy of an accepted
 * one (PAC-182) — fetched once per mount, never kept (`gcTime: 0`).
 */
export const payStatementPdfKey = (
  id: string,
  version: number,
  variant: StatementPdfVariant = "issued",
) => [...payStatementKey(id), "pdf", version, variant] as const;
/** A draft's preview, keyed by its calculation so a recalculation refreshes it. */
export const payStatementPreviewKey = (id: string, computedAt: string) =>
  [...payStatementKey(id), "preview", computedAt] as const;
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

/**
 * The figures the manager enters on a statement (2026 comp plans) — all
 * four, each `null` when not entered — and the statement recalculated with
 * them. `payouts:write`; 403 `PAYOUT_STATEMENT_OWN_INPUTS` on one's own
 * statement without `agency:payouts:admin`; 409
 * `PAYOUT_STATEMENT_NOT_EDITABLE` once sent or accepted.
 */
export function updatePayStatementInputs(
  id: string,
  input: UpdateStatementInputsInput,
): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/inputs`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

/**
 * The amounts a reviewer enters (10 Nov 2026), whole: Other bonuses /
 * SPIFFs (added), the compliance adjustment and other adjustments
 * (deducted), each positive or `null`, and a note on each (PAC-182; send all
 * three, `''` for none — they replace whole). Recalculates the statement. 409
 * `PAYOUT_STATEMENT_NOT_EDITABLE` once sent; 403
 * `PAYOUT_STATEMENT_OWN_STATEMENT` on one's own without the admin permission.
 */
export function updatePayStatementAdjustments(
  id: string,
  input: UpdateStatementAdjustmentsInput,
): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/adjustments`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

// ── Sending (PAC-181) ───────────────────────────────────────────────────

/**
 * Render the Commission Statement PDF, store it and send it to the employee.
 * `payouts:write`; 409 `PAYOUT_STATEMENT_NOT_EDITABLE` once sent, 409
 * `PAYOUT_RUN_GENERATING` while the month is being calculated.
 */
export function sendPayStatement(id: string): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/send`,
    { method: "POST" },
  );
}

/**
 * Send every draft of the month the caller may see; `branchId` narrows an
 * agency-wide reviewer to the branch the page is filtered to.
 */
export function sendAllDrafts(
  runId: string,
  { branchId }: { branchId?: string } = {},
): Promise<SendAllDraftsResponse> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return apiFetch<SendAllDraftsResponse>(
    `/payouts/runs/${encodeURIComponent(runId)}/send-all${query}`,
    { method: "POST" },
  );
}

/** A sent statement back to draft. 409 `PAYOUT_STATEMENT_NOT_SENT` otherwise. */
export function reopenPayStatement(id: string): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/reopen`,
    { method: "POST" },
  );
}

/**
 * A short-lived inline link to an issued PDF (the current version, or an
 * earlier one). Fetched when it is needed and never stored. `signed`
 * (PAC-182) is the signed copy of the current version of an accepted
 * statement; 404 for anything else.
 */
export function getPayStatementPdfLink(
  id: string,
  version?: number,
  variant?: StatementPdfVariant,
): Promise<PayStatementPdfLinkResponse> {
  const search = new URLSearchParams();
  if (version) search.set("version", String(version));
  if (variant) search.set("variant", variant);
  const query = search.toString();
  return apiFetch<PayStatementPdfLinkResponse>(
    `/payouts/statements/${encodeURIComponent(id)}/pdf${query ? `?${query}` : ""}`,
  );
}

// ── The employee's answer (PAC-182) ────────────────────────────────────

/**
 * The employee accepts their sent statement, signing it with their typed
 * name: final, and a signed copy of the PDF is stored. Only the statement's
 * own employee (403 `PAYOUT_STATEMENT_NOT_YOURS`), only while it is sent
 * (409 `PAYOUT_STATEMENT_NOT_SENT`); 409 `PAYOUT_STATEMENT_CHANGED` when a
 * reviewer changed it meanwhile.
 */
export function acceptPayStatement(
  id: string,
  input: AcceptPayStatementInput,
): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/accept`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * The employee disputes their sent statement, saying what is wrong; a
 * reviewer corrects it and sends it again. Same 403 / 409s as accepting.
 */
export function rejectPayStatement(
  id: string,
  input: RejectPayStatementInput,
): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/reject`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * One chargeback line with a note, and the statement recalculated: leave a
 * chargeback on it out, or add one the ledger does not hold. `payouts:write`,
 * draft or disputed only (409 `PAYOUT_STATEMENT_NOT_EDITABLE`); 409
 * `PAYOUT_CHARGEBACK_ALREADY_CHARGED` for a policy already charged back
 * (naming who and when only for this employee), 409
 * `PAYOUT_STATEMENT_CHANGED` when the statement changed meanwhile, 400 with
 * a message for a carrier not on the statement.
 */
export function addPayStatementAdjustment(
  id: string,
  input: AddStatementAdjustmentInput,
): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/adjustments`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

/**
 * Undo a chargeback line: restore a left-out chargeback, or remove an added
 * one — which deletes its ledger row. 400 for an entered amount (clear it
 * with {@link updatePayStatementAdjustments}).
 */
export function removePayStatementAdjustment(
  id: string,
  adjustmentId: string,
): Promise<PayStatementView> {
  return apiFetch<PayStatementView>(
    `/payouts/statements/${encodeURIComponent(id)}/adjustments/${encodeURIComponent(adjustmentId)}`,
    { method: "DELETE" },
  );
}

/** A draft's PDF, rendered now (`payouts:write`). */
export function fetchPayStatementPreview(id: string): Promise<Blob> {
  return apiFetchBlob(
    `/payouts/statements/${encodeURIComponent(id)}/pdf-preview`,
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

// ── Chargeback report import (PAC-180) ──────────────────────────────────

export const payoutImportsKey = [...payoutsKey, "imports"] as const;
export const payoutImportsListKey = (month: string) =>
  [...payoutImportsKey, "list", month] as const;
export const payoutImportKey = (id: string) =>
  [...payoutImportsKey, "detail", id] as const;
export const payoutImportPeopleKey = [...payoutImportsKey, "people"] as const;

/**
 * Presign → PUT the bytes straight to storage → create the preview. A 409
 * `PAYOUT_IMPORT_DUPLICATE_FILE` names the import that already holds the
 * file (`body.importId`); a 422 `PAYOUT_IMPORT_UNREADABLE_FILE` says why
 * the file was refused.
 */
export async function uploadChargebackReport(
  file: File,
  { carrier, month }: { carrier: string; month: string },
): Promise<ChargebackImportView> {
  const presigned = await apiFetch<ChargebackImportPresignResponse>(
    "/payouts/imports/presign",
    {
      method: "POST",
      body: JSON.stringify({ filename: file.name, size: file.size }),
    },
  );
  await uploadToPresignedUrl(
    presigned.uploadUrl,
    presigned.requiredHeaders,
    file,
  );
  return apiFetch<ChargebackImportView>("/payouts/imports", {
    method: "POST",
    body: JSON.stringify({
      storageKey: presigned.key,
      uploadedFilename: file.name,
      size: file.size,
      carrier,
      month,
    }),
  });
}

export function listChargebackImports(
  month: string,
): Promise<ChargebackImportsResponse> {
  return apiFetch<ChargebackImportsResponse>(
    `/payouts/imports?month=${encodeURIComponent(month)}`,
  );
}

export function getChargebackImport(id: string): Promise<ChargebackImportView> {
  return apiFetch<ChargebackImportView>(
    `/payouts/imports/${encodeURIComponent(id)}`,
  );
}

/** Everyone a line may be charged to, people who have left included. */
export function listImportPeople(): Promise<ImportPeopleResponse> {
  return apiFetch<ImportPeopleResponse>("/payouts/imports/people");
}

/** Assign / skip / include / reset one line of a preview. */
export function updateImportRow(
  id: string,
  rowNumber: number,
  action: ImportRowAction,
): Promise<UpdateImportRowResponse> {
  return apiFetch<UpdateImportRowResponse>(
    `/payouts/imports/${encodeURIComponent(id)}/rows/${rowNumber}`,
    { method: "PATCH", body: JSON.stringify(action) },
  );
}

/**
 * Write the charged lines and recalculate the month. 400
 * `PAYOUT_IMPORT_UNRESOLVED_ROWS` while a line needs a person.
 */
export function commitChargebackImport(
  id: string,
): Promise<ChargebackImportCommitResponse> {
  return apiFetch<ChargebackImportCommitResponse>(
    `/payouts/imports/${encodeURIComponent(id)}/commit`,
    { method: "POST" },
  );
}

/** Discard a preview; the same file may then be uploaded again. */
export function discardChargebackImport(
  id: string,
): Promise<ChargebackImportSummary> {
  return apiFetch<ChargebackImportSummary>(
    `/payouts/imports/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
