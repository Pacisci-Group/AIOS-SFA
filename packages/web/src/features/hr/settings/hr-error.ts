import { ApiError } from "@/lib/api-client";

/**
 * The message a failed HR request shows (PAC-161). The API answers a zod
 * failure with field errors and a merged-rules failure with one sentence per
 * problem; both are read into a single line the toast or `FormError` can show.
 */
export function hrErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as
      | {
          message?: string | string[];
          errors?: {
            fieldErrors?: Record<string, string[]>;
            formErrors?: string[];
          };
        }
      | undefined;
    const fieldErrors = body?.errors?.fieldErrors;
    if (fieldErrors) {
      const first = Object.entries(fieldErrors).find(
        ([, messages]) => messages.length > 0,
      );
      if (first) return `${first[0]}: ${first[1][0]}`;
    }
    const formError = body?.errors?.formErrors?.[0];
    if (formError) return formError;
    if (Array.isArray(body?.message)) return body.message.join(" ");
    if (typeof body?.message === "string") return body.message;
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
