import { useFieldContext } from "@/hooks/form-context";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useFieldError } from "./FieldShell";

interface CheckboxFieldProps {
  label: React.ReactNode;
  /** Rendered under the row, as the discount toggles do. */
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  /** Runs after the value changes — the discount toggles clear dependent state. */
  onChanged?: (checked: boolean) => void;
}

/**
 * A checkbox bound to the enclosing `form.AppField`.
 *
 * Normalises Radix's tri-state `onCheckedChange` to a strict boolean. That guard
 * was written by hand at three of the four previous call sites and **missing at
 * the fourth** (`PropertyAddressSection`'s "same as household" toggle), where an
 * `"indeterminate"` could be written into a `z.boolean()` field. Centralising it
 * fixes that for free.
 *
 * Replaces `DiscountsCard`'s bespoke `DiscountToggle`, which was already a
 * path-parameterised field component with a hand-maintained union of five
 * literal paths — the pattern this tier generalises.
 */
export function CheckboxField({
  label,
  hint,
  disabled,
  className,
  onChanged,
}: CheckboxFieldProps) {
  const field = useFieldContext<boolean>();
  const error = useFieldError(field.state.meta);

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-row items-center gap-2">
        <Checkbox
          id={field.name}
          checked={field.state.value}
          disabled={disabled}
          onCheckedChange={(checked) => {
            const next = checked === true;
            field.handleChange(next);
            field.handleBlur();
            onChanged?.(next);
          }}
        />
        <Label htmlFor={field.name} className="font-normal">
          {label}
        </Label>
      </div>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
