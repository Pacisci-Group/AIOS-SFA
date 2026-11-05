import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useFieldContext } from "@/hooks/form-context";
import { cn } from "@/lib/utils";
import { useFieldError } from "./FieldShell";

export interface ChecklistOption {
  value: string;
  label: string;
  /** A second line — an email, a branch. */
  detail?: string;
  /** Extra terms the search matches on. */
  keywords?: readonly string[];
  /** A short note on the right, e.g. where a person is today. */
  note?: React.ReactNode;
  /** Shown as a note only while the option is ticked. */
  noteWhenChosen?: React.ReactNode;
}

interface ChecklistFieldProps {
  options: readonly ChecklistOption[];
  searchPlaceholder?: string;
  /** Shown when nothing matches the search, or there are no options. */
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A searchable list of checkboxes whose value is the ticked options' values —
 * the Payouts structure's people step (PAC-177), and any "pick several from a
 * directory" field after it. A field component so the list is bound through
 * `form.AppField` like every other input, never by hand.
 *
 * "Select all" acts on what the search currently shows, so filtering to a
 * branch and ticking all does what it says.
 */
export function ChecklistField({
  options,
  searchPlaceholder = "Search",
  emptyText = "No matches.",
  disabled,
  className,
}: ChecklistFieldProps) {
  const field = useFieldContext<string[]>();
  const error = useFieldError(field.state.meta);
  const [search, setSearch] = useState("");
  const chosen = useMemo(() => new Set(field.state.value), [field.state.value]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      [option.label, option.detail ?? "", ...(option.keywords ?? [])].some(
        (text) => text.toLowerCase().includes(needle),
      ),
    );
  }, [options, search]);

  const allVisibleOn =
    visible.length > 0 && visible.every((option) => chosen.has(option.value));

  const set = (values: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const value of values) {
      if (on) next.add(value);
      else next.delete(value);
    }
    field.handleChange([...next]);
    field.handleBlur();
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={allVisibleOn}
            disabled={disabled || visible.length === 0}
            onCheckedChange={(checked) =>
              set(
                visible.map((option) => option.value),
                checked === true,
              )
            }
          />
          Select all{search.trim() ? " shown" : ""}
        </label>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {visible.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            {emptyText}
          </li>
        ) : (
          visible.map((option) => {
            const on = chosen.has(option.value);
            const note =
              on && option.noteWhenChosen ? option.noteWhenChosen : option.note;
            return (
              <li key={option.value}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-accent/50",
                    disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <Checkbox
                    checked={on}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      set([option.value], checked === true)
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                    {option.detail ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.detail}
                      </span>
                    ) : null}
                  </span>
                  {note ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {note}
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })
        )}
      </ul>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
