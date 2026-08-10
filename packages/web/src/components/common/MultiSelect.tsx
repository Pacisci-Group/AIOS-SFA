import { ChevronDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Trigger label when nothing is selected — e.g. `"All statuses"`. */
  placeholder: string;
  /** Trigger label when 2+ are selected — e.g. `(n) => \`${n} statuses\``. */
  summarize?: (count: number) => string;
  /** Applied to the trigger so callers control width/placement. */
  className?: string;
  align?: "start" | "end";
}

/**
 * A checkbox dropdown for filters that take several values at once.
 *
 * Built on `DropdownMenuCheckboxItem` rather than a `Select`: Radix's Select is
 * single-value by contract, and the menu primitive gives correct
 * `menuitemcheckbox` semantics for free. Selecting an item does **not** close
 * the menu — you normally pick more than one — so `onSelect` is suppressed.
 *
 * `onChange` always emits values in `options` order, so the emitted array is
 * canonical regardless of the order the user ticked things. That keeps it usable
 * as part of a query key.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  summarize = (count) => `${count} selected`,
  className,
  align = "start",
}: MultiSelectProps) {
  const selected = new Set(value);

  const toggle = (option: string) => {
    const next = new Set(selected);
    if (next.has(option)) {
      next.delete(option);
    } else {
      next.add(option);
    }
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };

  const label =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : summarize(value.length);

  return (
    <DropdownMenu>
      {/* Styled with `buttonVariants` rather than `<Button asChild>`: this
          repo's `Button` is a plain function component, so on React 18 the ref
          Radix's `Slot` needs to anchor the popper never reaches the DOM node
          and the menu fails to open. Radix's own trigger renders a real
          `<button>`, which takes the ref natively. */}
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "outline" }),
          "justify-between gap-2 font-normal bg-card border-border",
          value.length === 0 && "text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className="shrink-0 opacity-50" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={align}
        className="min-w-[var(--radix-dropdown-menu-trigger-width)] max-h-72"
      >
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.has(option.value)}
            // Keep the menu open: picking one value is rarely the whole intent.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggle(option.value)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}

        {value.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                onChange([]);
              }}
              className="text-muted-foreground"
            >
              Clear selection
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
