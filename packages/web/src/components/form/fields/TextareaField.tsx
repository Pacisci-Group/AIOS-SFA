import { useFieldContext } from "@/hooks/form-context";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FieldShell, useFieldError } from "./FieldShell";

interface TextareaFieldProps {
  label?: React.ReactNode;
  /** Visually hidden label, as the Quote Recap's Notes field uses. */
  srOnlyLabel?: boolean;
  description?: React.ReactNode;
  rows?: number;
  placeholder?: string;
  /**
   * The longest the text may be: set on the textarea, and counted under it
   * (`n / max`). The zod schema still says the same — this only stops typing
   * at the limit and shows how close it is.
   */
  maxLength?: number;
  disabled?: boolean;
  className?: string;
  textareaClassName?: string;
}

/** A multi-line text input bound to the enclosing `form.AppField`. */
export function TextareaField({
  label,
  srOnlyLabel,
  description,
  rows,
  placeholder,
  maxLength,
  disabled,
  className,
  textareaClassName,
}: TextareaFieldProps) {
  const field = useFieldContext<string | undefined>();
  const error = useFieldError(field.state.meta);
  const length = (field.state.value ?? "").length;

  return (
    <FieldShell
      label={srOnlyLabel ? <span className="sr-only">{label}</span> : label}
      description={description}
      error={error}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <>
          <Textarea
            id={id}
            rows={rows}
            placeholder={placeholder}
            maxLength={maxLength}
            disabled={disabled}
            className={textareaClassName}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={field.state.value ?? ""}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
          />
          {maxLength !== undefined && (
            <p
              data-slot="form-counter"
              className={cn(
                "-mt-1 text-right text-xs text-muted-foreground tabular-nums",
                length >= maxLength && "text-destructive",
              )}
            >
              {length} / {maxLength}
            </p>
          )}
        </>
      )}
    </FieldShell>
  );
}
