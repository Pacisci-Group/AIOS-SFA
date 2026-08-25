import type { LogMailerLeadResponse, MailerLookupView } from "@sfa/shared";
import { ApiError, apiFetch } from "@/lib/api-client";

/**
 * The Mailers drawer's read + log-lead calls (PAC-61).
 *
 * Not to be confused with `platform-mailers-api.ts`, which is the Super Admin
 * RTP upload (PAC-73) and needs `platform:mailers:*`. These two share a noun
 * and nothing else: one imports mail files, the other reads one mailer a
 * producer typed the control number of.
 */
export type { LogMailerLeadResponse, MailerLookupView };

/**
 * Look a mailer up by either printed form of its Quote Control Number.
 *
 * Returns **`null`**, not a thrown error, when nothing carries that number.
 *
 * A 404 here is the ordinary case, not a failure: a producer half-way through
 * typing a control number has not made a mistake. Absorbing it in the api layer
 * is what lets the drawer render its "no record" empty state from `data ===
 * null` on a *successful* query rather than from `isError` — and keeps TanStack
 * Query from retrying a miss that will never become a hit.
 *
 * `key` is expected to be already normalized (`mailerControlNumberKey`), which
 * is what keeps a literal `#` out of the URL path, where it would otherwise
 * start a fragment and never reach the server. The server re-normalizes anyway.
 */
export async function lookupMailer(
  key: string,
): Promise<MailerLookupView | null> {
  try {
    return await apiFetch<MailerLookupView>(
      `/mailers/${encodeURIComponent(key)}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Save the mailer's recipient as a lead.
 *
 * Idempotent per mailer: logging the same one twice — in either control-number
 * form — returns the first lead with `alreadyExisted: true` and creates
 * nothing.
 */
export function logMailerLead(
  controlNumber: string,
): Promise<LogMailerLeadResponse> {
  return apiFetch<LogMailerLeadResponse>("/mailers/log-lead", {
    method: "POST",
    body: JSON.stringify({ controlNumber }),
  });
}
