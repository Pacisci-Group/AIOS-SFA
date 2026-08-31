/**
 * The **field-binding tier** — the only place in the app that knows which form
 * library is in use. Everything in `../` (the layout tier) is library-agnostic
 * by design; if the binding ever changes again, this directory is the whole
 * blast radius.
 *
 * These are registered as `fieldComponents` on `useAppForm` (`@/hooks/form`) and
 * reached as `<field.TextField />` inside a `form.AppField`. Import them
 * directly only when composing a new field type.
 *
 * Two rules hold for every component here:
 *  1. **Never hardcode a field path.** The path comes from `name` on `AppField`
 *     at the call site, so renaming a schema field is a compile error rather
 *     than a silent runtime break. This is the defect the tier exists to fix —
 *     see `docs/tanstack-form-spike-findings.md`.
 *  2. **No validation logic.** Rules live in the zod schema, conditionals in
 *     `superRefine`. Markup decides how a message looks, never whether it fires.
 */
export { TextField } from "./TextField";
export { AddressAutocompleteField } from "./AddressAutocompleteField";
export { NumberField } from "./NumberField";
export { SelectField } from "./SelectField";
export { CheckboxField } from "./CheckboxField";
export { TextareaField } from "./TextareaField";
export { FieldShell, useFieldError } from "./FieldShell";
export type { SelectOption } from "./SelectField";
