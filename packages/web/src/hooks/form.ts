import { createFormHook } from "@tanstack/react-form";
import {
  AddressAutocompleteField,
  CheckboxField,
  NumberField,
  SelectField,
  TextField,
  TextareaField,
} from "@/components/form/fields";
import { fieldContext, formContext } from "./form-context";

/**
 * The app's form hook. Build every form with `useAppForm` — see AGENTS.md §11.
 *
 * `fieldComponents` is the one field-type → component map: the single place a
 * field type is named, and the extension point if forms ever become
 * configuration-driven. Registered components are reached as
 * `<field.TextField />` inside `form.AppField`, fully typed against the form's
 * own schema.
 *
 * Validation is zod, passed straight to `validators` via Standard Schema — no
 * resolver package.
 *
 * **Use `validators: { onBlur: schema }`.** It matches the react-hook-form
 * `mode: "onBlur"` these forms were built with, and it is the only key that both
 * surfaces errors on blur *and* answers a `"submit"`-cause `validateField` call,
 * which is what the Sold wizard's per-card validation depends on. See
 * `docs/tanstack-form-spike-findings.md`.
 */
export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldComponents: {
    TextField,
    NumberField,
    SelectField,
    CheckboxField,
    TextareaField,
    AddressAutocompleteField,
  },
  formComponents: {},
  fieldContext,
  formContext,
});

export { useFieldContext, useFormContext } from "./form-context";
