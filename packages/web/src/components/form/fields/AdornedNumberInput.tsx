import { useFieldContext } from "@/hooks/form-context";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FieldShell, useFieldError } from "./FieldShell";

export interface AdornedNumberFieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

/**
 * A number input with a unit beside it — `$` before, `%` after. The shared
 * body of {@link MoneyField} and {@link PercentField}.
 *
 * Like `NumberField`, the value stays a **string** in form state and is
 * converted at each form's submit mapper (`lib/zod-helpers.ts`
 * `numericString()` explains why an untouched field must not read as 0).
 */
export function AdornedNumberInput({
  label,
  description,
  placeholder,
  disabled,
  className,
  inputClassName,
  prefix,
  suffix,
  step,
  min,
  max,
}: AdornedNumberFieldProps & {
  prefix?: string;
  suffix?: string;
  step: string;
  min?: string;
  max?: string;
}) {
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
        <div className="relative">
          {prefix ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
            >
              {prefix}
            </span>
          ) : null}
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(prefix && "pl-7", suffix && "pr-8", inputClassName)}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={field.state.value ?? ""}
            onChange={(e) => field.handleChange(e.target.value)}
            onBlur={field.handleBlur}
          />
          {suffix ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
            >
              {suffix}
            </span>
          ) : null}
        </div>
      )}
    </FieldShell>
  );
}
