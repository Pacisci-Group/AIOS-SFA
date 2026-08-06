import type { Ref } from "react";
import { useFieldContext } from "@/hooks/form-context";
import { Input } from "@/components/ui/input";
import { FieldShell, useFieldError } from "./FieldShell";

interface TextFieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  type?: "text" | "email" | "tel" | "date" | "url";
  inputMode?: React.ComponentProps<"input">["inputMode"];
  autoComplete?: string;
  placeholder?: string;
  /** DOM `disabled` only — never the library's, which nulls the value. */
  disabled?: boolean;
  /** On the wrapper, e.g. `sm:col-span-2`. */
  className?: string;
  /** On the `<input>`. Sites differ: the lead/quote forms use `bg-card border-border`, the wizard doesn't. */
  inputClassName?: string;
  /** Runs after the field's own blur — the Sold wizard's policy-number dedupe check. */
  onBlur?: () => void;
  /** The wizard focuses the policy-number input from its duplicate notice. */
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * A single-line text input bound to the enclosing `form.AppField`.
 *
 * The field path is supplied by the `name` on `AppField` at the call site — this
 * component never knows or hardcodes a path, which is what makes a schema rename
 * a compile error rather than a silent runtime break.
 */
export function TextField({
  label,
  description,
  type,
  inputMode,
  autoComplete,
  placeholder,
  disabled,
  className,
  inputClassName,
  onBlur,
  inputRef,
}: TextFieldProps) {
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
          ref={inputRef}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          className={inputClassName}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          value={field.state.value ?? ""}
          onChange={(e) => field.handleChange(e.target.value)}
          onBlur={() => {
            field.handleBlur();
            onBlur?.();
          }}
        />
      )}
    </FieldShell>
  );
}
