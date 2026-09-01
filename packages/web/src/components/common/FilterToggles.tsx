import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A segmented row of mutually-exclusive filters — the ticket queue's
 * All/Open/Waiting/Resolved, the household feed's All/Open/Overdue/Resolved.
 *
 * ## Why not `Tabs`
 *
 * It looks like a tab bar, and both call sites were built with `ui/tabs` first.
 * But Radix's `Tabs.Trigger` unconditionally emits
 * `aria-controls="<generated content id>"`, and neither of these has a
 * `TabsContent` to point at — the filtered results live in a separate scroll
 * region, not in a tabpanel. That leaves every control announcing as a *tab*
 * whose panel does not exist, and trips axe's `aria-valid-attr-value`.
 *
 * These are toggle buttons over one list, so that is what they are: a labelled
 * `group` of `aria-pressed` buttons. It keeps the "every clickable thing goes
 * through `Button`" rule from `styles/TYPOGRAPHY.md`, and the styling mirrors
 * `TabsList`/`TabsTrigger` so the segmented look is unchanged.
 */
export function FilterToggles<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Accessible name for the group, e.g. "Filter tickets by status". */
  label: string;
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex h-9 w-full items-center gap-0.5 rounded-lg bg-muted p-[3px]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-full flex-1 px-2 text-sm font-medium",
              active
                ? // Matches `TabsTrigger`'s own active treatment, `dark:` half
                  // included — see `ui/tabs.tsx`.
                  "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
                : "text-foreground/60 hover:text-foreground dark:text-muted-foreground",
            )}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
