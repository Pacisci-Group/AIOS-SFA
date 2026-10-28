import type { AnyFieldLikeMetaBase } from "@tanstack/react-form";

/**
 * Pin a server's refusal to one field: `form.setFieldMeta(name,
 * serverFieldError(message))`.
 *
 * For a refusal only the server can make — a code another user already holds
 * — where the response names the field, so the message belongs under that
 * input rather than in the form's banner.
 *
 * Written into the **`onSubmit`** slot on purpose. form-core clears a field's
 * `onSubmit` error by itself the moment the field next validates clean (an
 * edit, a blur, the next submit), so the message disappears once the person
 * has changed the value — a slot no validator owns (`onServer`) would stay
 * up until something cleared it by hand. `isTouched` is set because
 * `useFieldError` hides errors on untouched fields.
 */
export function serverFieldError(message: string) {
  return (meta: AnyFieldLikeMetaBase): AnyFieldLikeMetaBase => ({
    ...meta,
    isTouched: true,
    errorMap: { ...meta.errorMap, onSubmit: message },
  });
}
