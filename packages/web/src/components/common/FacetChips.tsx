import { cn } from "@/lib/utils";

export interface FacetChipOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A facet as a row of toggle chips: ORed, applied as they are clicked — no
 * Apply button, the product rule for every facet. None selected means no
 * filter. The bordered-pill treatment of the Leads scope toggle, so every
 * list reads as one app.
 *
 * Lifted from the People list's status facet (PAC-162) when the Time off
 * team list became its second caller (PAC-165).
 */
export function FacetChips<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** The accessible name of the group: "Filter by status". */
  label: string;
  options: readonly FacetChipOption<T>[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  className?: string;
}) {
  const toggle = (option: T) =>
    onChange(
      value.includes(option) ? value.filter((entry) => entry !== option) : [...value, option],
    );

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex w-fit flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1",
        className,
      )}
    >
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(option.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              on
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
