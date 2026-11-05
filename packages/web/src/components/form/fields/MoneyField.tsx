import {
  AdornedNumberInput,
  type AdornedNumberFieldProps,
} from "./AdornedNumberInput";

/** A dollar amount, cents allowed. The value is a string in form state. */
export function MoneyField(props: AdornedNumberFieldProps) {
  return <AdornedNumberInput {...props} prefix="$" step="0.01" min="0" />;
}
