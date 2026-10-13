import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/** The row of controls under a panel's title. Wraps on a phone. */
export function PanelToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
  );
}

/** A select whose trigger says what it chooses: "Group by · Producer". */
export function LabelledSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger size="sm" aria-label={label} className="min-w-0">
        <span className="text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "Compare with prior period" — one switch, the same URL key on every panel. */
export function CompareSwitch({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground"
    >
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      Compare with prior period
    </label>
  );
}
