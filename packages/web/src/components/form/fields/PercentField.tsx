import {
  AdornedNumberInput,
  type AdornedNumberFieldProps,
} from "./AdornedNumberInput";

/** A percentage on the 0–100 scale. The value is a string in form state. */
export function PercentField(props: AdornedNumberFieldProps) {
  return (
    <AdornedNumberInput {...props} suffix="%" step="0.01" min="0" max="100" />
  );
}
