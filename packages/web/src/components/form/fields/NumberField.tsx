import { useFieldContext } from "@/hooks/form-context";
import { Input } from "@/components/ui/input";
import { FieldShell, useFieldError } from "./FieldShell";

interface NumberFieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  inputMode?: "numeric" | "decimal";
  step?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

/**
 * A numeric input whose value stays a **string** in form state.
 *
 * That is deliberate and must not be "fixed" to a number: see
 * `lib/zod-helpers.ts` `numericString()`. Coercing turns an untouched `""` into
 * `0`, which passes `.min(0)`, so a producer who never filled the field silently
 * submits a $0 premium. This component owns the input *attributes*
 * (`type="number"`, `inputMode`, `step`/`min`/`max`), not the value type; the
 * conversion to numbers happens at each form's submit mapper.
 */
export function NumberField({
  label,
  description,
  inputMode = "decimal",
  step,
  min,
  max,
  placeholder,
  disabled,
  className,
  inputClassName,
}: NumberFieldProps) {
  const field = useFieldContext<string | undefined>();
  const error = useFieldError(field.state.meta);

  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type="number"
          inputMode={inputMode}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          disabled={disabled}
          className={inputClassName}
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
