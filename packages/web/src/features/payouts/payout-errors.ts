import {
  PAYOUT_RUN_GENERATING,
  PAYOUT_STATEMENT_CHANGED,
  PAYOUT_STATEMENT_NOT_EDITABLE,
  PAYOUT_STATEMENT_NOT_SENT,
  PAYOUT_STATEMENT_OWN_INPUTS,
  PAYOUT_STATEMENT_OWN_STATEMENT,
} from "@sfa/shared";
import { ApiError } from "@/lib/api-client";

/**
 * The page's own words for a refusal whose cause the person may not see from
 * the page. Keyed by `code`, never by the API's message.
 */
const CODE_MESSAGES: Record<string, string> = {
  [PAYOUT_STATEMENT_OWN_INPUTS]:
    "Someone else enters the figures on your own statement — they decide your pay.",
  [PAYOUT_STATEMENT_OWN_STATEMENT]:
    "Someone else recalculates, sends and reopens your own statement — it is your pay.",
  // Sending, or (rarely) reopening, raced a change to the statement.
  [PAYOUT_STATEMENT_CHANGED]:
    "It changed while it was being sent or reopened. Review it and try again.",
  [PAYOUT_STATEMENT_NOT_EDITABLE]:
    "This statement has been sent, so it can no longer change. Reload to see where it stands.",
  [PAYOUT_STATEMENT_NOT_SENT]:
    "Only a sent statement can be reopened. Reload to see where it stands.",
  [PAYOUT_RUN_GENERATING]:
    "This month is being calculated right now. Try again in a minute.",
};

/**
 * What to tell someone when a Payouts request fails.
 *
 * The API's validation 400 says only "Validation failed" in `message` and
 * puts the reason — "The CSR and producer shares must add up to 100%." — in
 * `errors`. The form checks the same rules first, so reaching this is rare,
 * but when it happens the rule is what the person needs to read.
 */
export function payoutErrorMessage(error: unknown): string {
  const code = payoutErrorCode(error);
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (error instanceof ApiError) {
    const body = error.body as
      | {
          errors?: {
            fieldErrors?: Record<string, string[] | undefined>;
            formErrors?: string[];
          };
        }
      | undefined;
    const errors = body?.errors;
    const first =
      errors?.formErrors?.[0] ??
      Object.values(errors?.fieldErrors ?? {}).find(
        (messages) => messages?.length,
      )?.[0];
    return first ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * The `code` of a structured refusal (`{ code, message }`), e.g.
 * `PAYMENT_STRUCTURE_NAME_TAKEN` — what a page branches on, never the message.
 */
export function payoutErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const code = (error.body as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : null;
}
