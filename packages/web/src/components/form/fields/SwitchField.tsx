import { useFieldContext } from "@/hooks/form-context";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useFieldError } from "./FieldShell";

interface SwitchFieldProps {
  label: React.ReactNode;
  /** Under the label, the sentence that says what "on" does. */
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  /** Runs after the value changes — a toggle that reveals dependent fields. */
  onChanged?: (checked: boolean) => void;
  /** Rendered under the row while the switch is on: the fields it reveals. */
  children?: React.ReactNode;
}

/**
 * An on/off setting bound to the enclosing `form.AppField`: label and hint on
 * the left, the switch on the right, the Gusto "Settings" card row. Added
 * for the time off policy wizard (PAC-174), whose settings are all toggles
 * with a field or two behind each.
 *
 * A `Switch` rather than {@link CheckboxField}: a checkbox says "include
 * this", a switch says "this is on" — and these rows are settings, not
 * selections. Radix's `onCheckedChange` is already a boolean here.
 */
export function SwitchField({
  label,
  hint,
  disabled,
  className,
  onChanged,
  children,
}: SwitchFieldProps) {
  const field = useFieldContext<boolean>();
  const error = useFieldError(field.state.meta);
  const on = field.state.value;

  return (
    <div
      data-slot="form-item"
      className={cn("grid content-start gap-3 rounded-lg border border-border bg-card p-4", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={field.name} className="text-sm font-medium">
            {label}
          </Label>
          {hint ? (
            <p data-slot="form-description" className="text-sm text-muted-foreground">
              {hint}
            </p>
          ) : null}
        </div>
        <Switch
          id={field.name}
          checked={on}
          disabled={disabled}
          onCheckedChange={(checked) => {
            field.handleChange(checked);
            field.handleBlur();
            onChanged?.(checked);
          }}
        />
      </div>
      {on && children ? <div className="border-t border-border pt-3">{children}</div> : null}
      {error ? (
        <p data-slot="form-message" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
