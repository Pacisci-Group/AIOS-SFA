import { useFieldContext } from "@/hooks/form-context";
import { Textarea } from "@/components/ui/textarea";
import { FieldShell, useFieldError } from "./FieldShell";

interface TextareaFieldProps {
  label?: React.ReactNode;
  /** Visually hidden label, as the Quote Recap's Notes field uses. */
  srOnlyLabel?: boolean;
  description?: React.ReactNode;
  rows?: number;
  placeholder?: string;
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
  disabled,
  className,
  textareaClassName,
}: TextareaFieldProps) {
  const field = useFieldContext<string | undefined>();
  const error = useFieldError(field.state.meta);

  return (
    <FieldShell
      label={srOnlyLabel ? <span className="sr-only">{label}</span> : label}
      description={description}
      error={error}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <Textarea
          id={id}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          className={textareaClassName}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          value={field.state.value ?? ""}
          onChange={(e) => field.handleChange(e.target.value)}
          onBlur={field.handleBlur}
        />
      )}
    </FieldShell>
  );
}
