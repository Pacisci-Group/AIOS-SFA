import { createFormHookContexts } from "@tanstack/react-form";

/**
 * The form/field contexts, split into their own module purely to break a cycle:
 * `hooks/form.ts` needs the field components to build `useAppForm`, and the
 * field components need `useFieldContext` to read their field. Both import from
 * here instead of from each other.
 *
 * Import `useAppForm` from `@/hooks/form` — not this file — when building a form.
 */
export const { fieldContext, useFieldContext, formContext, useFormContext } =
  createFormHookContexts();
