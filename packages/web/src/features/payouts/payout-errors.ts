import { ApiError } from "@/lib/api-client";

/**
 * What to tell someone when a Payouts request fails.
 *
 * The API's validation 400 says only "Validation failed" in `message` and
 * puts the reason — "The CSR and producer shares must add up to 100%." — in
 * `errors`. The form checks the same rules first, so reaching this is rare,
 * but when it happens the rule is what the person needs to read.
 */
export function payoutErrorMessage(error: unknown): string {
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
