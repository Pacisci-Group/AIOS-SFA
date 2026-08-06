import { useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface FieldShellRenderProps {
  /** Put on the control so the label's `htmlFor` reaches it. */
  id: string;
  /** For `aria-describedby` on the control. */
  describedBy: string | undefined;
  invalid: boolean;
}

interface FieldShellProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  /** First validation message, or undefined. See {@link useFieldError}. */
  error?: string;
  /** Applied to the wrapper — this is where `sm:col-span-2` goes. */
  className?: string;
  children: (props: FieldShellRenderProps) => React.ReactNode;
}

/**
 * The label / control / message wrapper every field component renders.
 *
 * Reproduces the exact DOM and classes of the shadcn `FormItem` + `FormLabel` +
 * `FormMessage` trio this replaced (`grid gap-2`, `text-sm text-destructive`,
 * the `data-[error=true]` label treatment, the `-form-item` / `-form-item-message`
 * id convention), so the migration off react-hook-form is invisible on screen.
 * Do not "modernise" these classes here — shadcn's current `Field` primitive
 * uses `gap-3`, and adopting it would silently reflow every form in the app.
 */
export function FieldShell({
  label,
  description,
  error,
  className,
  children,
}: FieldShellProps) {
  const uid = useId();
  const id = `${uid}-form-item`;
  const descriptionId = description ? `${uid}-form-item-description` : undefined;
  const messageId = error ? `${uid}-form-item-message` : undefined;
  const describedBy =
    [descriptionId, messageId].filter(Boolean).join(" ") || undefined;

  return (
    <div data-slot="form-item" className={cn("grid gap-2", className)}>
      {label ? (
        <Label
          data-slot="form-label"
          data-error={!!error}
          className="data-[error=true]:text-destructive"
          htmlFor={id}
        >
          {label}
        </Label>
      ) : null}
      {children({ id, describedBy, invalid: !!error })}
      {description ? (
        <p
          data-slot="form-description"
          id={descriptionId}
          className="text-sm text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
      {error ? (
        <p
          data-slot="form-message"
          id={messageId}
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface FieldLikeMeta {
  errors: unknown[];
  isTouched: boolean;
}

/**
 * The first validation message to show for a field, or `undefined`.
 *
 * **Gated on `isTouched`, and that gate is load-bearing.** A single form-level
 * zod schema validates the *whole* object on every run, so TanStack writes an
 * error into every invalid field's meta as soon as any one field blurs. Ungated,
 * tabbing out of the first input turns the entire form red — which react-hook-form's
 * `mode: "onBlur"` never did. `isTouched` stays false until a field is actually
 * visited, so gating on it restores the previous behaviour exactly.
 *
 * Per-card validation in the Sold wizard goes through `form.validateField`, which
 * marks the field touched before validating, so blocked steps still show their
 * errors.
 */
export function useFieldError(meta: FieldLikeMeta): string | undefined {
  if (!meta.isTouched) return undefined;
  const first = meta.errors[0];
  if (!first) return undefined;
  if (typeof first === "string") return first;
  if (typeof first === "object" && "message" in first) {
    return String((first as { message: unknown }).message);
  }
  return undefined;
}
