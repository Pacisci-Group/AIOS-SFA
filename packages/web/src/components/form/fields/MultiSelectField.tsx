import { useFieldContext } from "@/hooks/form-context";
import { MultiSelect, type MultiSelectOption } from "@/components/common/MultiSelect";
import { FieldShell, useFieldError } from "./FieldShell";

interface MultiSelectFieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  options: readonly MultiSelectOption[];
  /** The trigger's text with nothing ticked — e.g. `"Choose branches"`. */
  placeholder: string;
  /** The trigger's text with two or more ticked — e.g. `(n) => \`${n} branches\``. */
  summarize?: (count: number) => string;
  className?: string;
}

/**
 * Several values from a list, bound to the enclosing `form.AppField` — the
 * checkbox dropdown (`common/MultiSelect`) inside the field shell. Added for
 * the agency event form (PAC-169), whose audience is "these branches" or
 * "these people".
 *
 * The value is a `string[]` in the options' order, whatever order they were
 * ticked in. ⚠ A TanStack *array* field ignores `form.reset` (see
 * `docs/tanstack-form-spike-findings.md`): seed it through `defaultValues`
 * before the form mounts, and re-seed by remounting.
 */
export function MultiSelectField({
  label,
  description,
  options,
  placeholder,
  summarize,
  className,
}: MultiSelectFieldProps) {
  const field = useFieldContext<string[]>();
  const error = useFieldError(field.state.meta);

  return (
    <FieldShell label={label} description={description} error={error} className={className}>
      {() => (
        <MultiSelect
          options={options}
          value={field.state.value ?? []}
          onChange={(next) => {
            field.handleChange(next);
            field.handleBlur();
          }}
          placeholder={placeholder}
          summarize={summarize}
          className="w-full justify-between"
          align="start"
        />
      )}
    </FieldShell>
  );
}
