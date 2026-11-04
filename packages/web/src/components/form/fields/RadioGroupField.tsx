import { useId } from "react";
import { useFieldContext } from "@/hooks/form-context";
import { ChoiceRow } from "@/components/common/ChoiceRow";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useFieldError } from "./FieldShell";

export interface RadioGroupOption<V extends string> {
  value: V;
  label: string;
  caption: string;
  disabled?: boolean;
}

interface RadioGroupFieldProps<V extends string> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  options: readonly RadioGroupOption<V>[];
  /** Disables every option — a choice locked after activation. */
  disabled?: boolean;
  className?: string;
  /** Two columns from `sm` up; a short list of two or three choices. */
  columns?: 1 | 2;
  onChanged?: (value: V) => void;
}

/**
 * A short list of titled choices bound to the enclosing `form.AppField` —
 * one {@link ChoiceRow} per option under a `radiogroup`. For the choices a
 * select would hide the explanation of: paid or unpaid, fixed amount or
 * unlimited, yearly or monthly (PAC-174).
 */
export function RadioGroupField<V extends string>({
  label,
  description,
  options,
  disabled,
  className,
  columns = 2,
  onChanged,
}: RadioGroupFieldProps<V>) {
  const field = useFieldContext<V>();
  const error = useFieldError(field.state.meta);
  const labelId = useId();

  return (
    <div data-slot="form-item" className={cn("grid content-start gap-2", className)}>
      {label ? (
        <Label id={labelId} data-error={!!error} className="data-[error=true]:text-destructive">
          {label}
        </Label>
      ) : null}
      <div
        role="radiogroup"
        aria-labelledby={label ? labelId : undefined}
        className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2")}
      >
        {options.map((option) => (
          <ChoiceRow
            key={option.value}
            selected={field.state.value === option.value}
            disabled={disabled || option.disabled}
            title={option.label}
            caption={option.caption}
            onSelect={() => {
              field.handleChange(option.value);
              field.handleBlur();
              onChanged?.(option.value);
            }}
          />
        ))}
      </div>
      {description ? (
        <p data-slot="form-description" className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p data-slot="form-message" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
