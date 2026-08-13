import { useFieldContext } from "@/hooks/form-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldShell, useFieldError } from "./FieldShell";

/** A bare string, or an explicit value/label pair. */
export type SelectOption<V extends string> =
  | V
  | { value: V; label: React.ReactNode };

interface SelectFieldProps<V extends string> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  options: readonly SelectOption<V>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** On the trigger. Sites differ — some use `w-full bg-card border-border`. */
  triggerClassName?: string;
  /**
   * Runs after the value changes — the same escape hatch {@link CheckboxField}
   * carries, for a select whose choice invalidates other state. The Sold
   * wizard's policy type uses it to clear the discount branch that no longer
   * applies.
   */
  onChanged?: (value: V) => void;
}

const optionValue = <V extends string>(o: SelectOption<V>): V =>
  typeof o === "string" ? o : o.value;
const optionLabel = <V extends string>(o: SelectOption<V>): React.ReactNode =>
  typeof o === "string" ? o : o.label;

/**
 * A select bound to the enclosing `form.AppField`.
 *
 * The union option type covers all three shapes in use without forcing a `.map`
 * at every site: `POLICY_TYPE_OPTIONS` and `HOUSEHOLD_MEMBER_ROLES` are plain
 * string arrays, while `SELECTABLE_LEAD_SOURCE_OPTIONS` is `{code,label}` and
 * needs one rename at its single call site.
 *
 * Note only the **trigger** carries the field wiring. Radix renders the content
 * in a portal, so putting the aria/id plumbing on the wrapper would attach it to
 * a node that isn't in the labelled region.
 */
export function SelectField<V extends string>({
  label,
  description,
  options,
  placeholder,
  disabled,
  className,
  triggerClassName,
  onChanged,
}: SelectFieldProps<V>) {
  const field = useFieldContext<V | undefined>();
  const error = useFieldError(field.state.meta);

  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <Select
          value={field.state.value ?? ""}
          onValueChange={(v) => {
            field.handleChange(v as V);
            // A select has no blur worth waiting for — a choice is final the
            // moment it is made, so mark it touched now or its error would
            // never show.
            field.handleBlur();
            onChanged?.(v as V);
          }}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className={triggerClassName}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={optionValue(o)} value={optionValue(o)}>
                {optionLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FieldShell>
  );
}
