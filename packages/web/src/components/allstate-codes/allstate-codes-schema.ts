import {
  ALLSTATE_CODE_DUPLICATE,
  ALLSTATE_CODE_FIELDS,
  bindIdError,
  subProducerCodeError,
  type AllstateCodeField,
} from "@sfa/shared";
import { z } from "zod";
import { ApiError } from "@/lib/api-client";

/**
 * A person's two Allstate codes (PAC-173) as every form holds them: the Bind
 * ID and the sub-producer code, both optional, both plain strings in form
 * state (`''` = none).
 *
 * The rules are `@sfa/shared`'s `bindIdError` / `subProducerCodeError` — the
 * same functions the API's DTOs call — so the browser refuses exactly what
 * the server would. Normalising (upper-casing `sok5pe0t`, padding `34` to
 * `034`) is the server's job; the form sends what was typed, trimmed.
 *
 * Five forms carry these (invite, accept invite, profile, the owner's edit,
 * platform onboarding), so the fragment is spread into each schema rather
 * than restated, and {@link AllstateCodeFields} renders the inputs.
 */
const checked = (problem: (value: string) => string | null) =>
  z.string().superRefine((value, ctx) => {
    const message = problem(value);
    if (message) ctx.addIssue({ code: "custom", message });
  });

/** Spread into a form's `z.object({...})` beside its other fields. */
export const allstateCodesShape = {
  allstateBindId: checked(bindIdError),
  allstateSubProducerCode: checked(subProducerCodeError),
} satisfies Record<AllstateCodeField, z.ZodType<string>>;

export const allstateCodesSchema = z.object(allstateCodesShape);
export type AllstateCodesValues = z.infer<typeof allstateCodesSchema>;

export const EMPTY_ALLSTATE_CODES: AllstateCodesValues = {
  allstateBindId: "",
  allstateSubProducerCode: "",
};

/** Stored codes (`null` / absent when unset) → form state. */
export function allstateCodesFormValues(
  source: Partial<Record<AllstateCodeField, string | null>>,
): AllstateCodesValues {
  return {
    allstateBindId: source.allstateBindId ?? "",
    allstateSubProducerCode: source.allstateSubProducerCode ?? "",
  };
}

/**
 * Form state → a **create** body (invite, onboarding): a blank code is
 * omitted, because absent is "none" and there is nothing to clear yet.
 */
export function allstateCodesForCreate(
  values: AllstateCodesValues,
): Partial<Record<AllstateCodeField, string>> {
  const out: Partial<Record<AllstateCodeField, string>> = {};
  for (const field of ALLSTATE_CODE_FIELDS) {
    const value = values[field].trim();
    if (value) out[field] = value;
  }
  return out;
}

/**
 * Form state → an **edit** body (profile, the owner's edit): every code is
 * sent, a blank one as `null`, which clears it — the `clearable` PATCH
 * convention, where an absent key would mean "leave it".
 */
export function allstateCodesForUpdate(
  values: AllstateCodesValues,
): Record<AllstateCodeField, string | null> {
  return {
    allstateBindId: values.allstateBindId.trim() || null,
    allstateSubProducerCode: values.allstateSubProducerCode.trim() || null,
  };
}

/** A `409 ALLSTATE_CODE_DUPLICATE`, read off the error body. */
export interface AllstateCodeConflict {
  field: AllstateCodeField;
  /** The server's sentence, which names who already holds the code. */
  message: string;
}

/**
 * The duplicate-code refusal, if that is what `error` is.
 *
 * Every write that takes a code can answer `409 { code:
 * 'ALLSTATE_CODE_DUPLICATE', field, message }` — the code is unique within
 * the agency, and only the server can see who else holds it. The `field`
 * lets the form put the message under the input that caused it (see
 * `serverFieldError`) rather than in the banner.
 */
export function allstateCodeConflict(
  error: unknown,
): AllstateCodeConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as
    | { code?: unknown; field?: unknown; message?: unknown }
    | undefined;
  if (body?.code !== ALLSTATE_CODE_DUPLICATE) return null;
  const field = ALLSTATE_CODE_FIELDS.find((name) => name === body.field);
  if (!field) return null;
  return {
    field,
    message: typeof body.message === "string" ? body.message : error.message,
  };
}
