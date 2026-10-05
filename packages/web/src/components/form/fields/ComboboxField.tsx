import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useFieldContext } from "@/hooks/form-context";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FieldShell, useFieldError } from "./FieldShell";

export interface ComboboxOption<V extends string> {
  value: V;
  label: string;
  /** Extra terms the search box matches on besides `value` and `label`. */
  keywords?: readonly string[];
  /** Options sharing a `group` render under one heading, in first-seen order. */
  group?: string;
}

interface ComboboxFieldProps<V extends string> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  options: readonly ComboboxOption<V>[];
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown when the search matches nothing. */
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** On the trigger. Sites differ — the wizard uses `bg-card border-border`. */
  triggerClassName?: string;
  /** Runs after the value changes — the same escape hatch `SelectField` has. */
  onChanged?: (value: V) => void;
}

/**
 * Plain substring matching over the value and its keywords, not cmdk's
 * default fuzzy scorer. The default matches scattered letters, so "kolkata"
 * ranked `America/Kentucky/Monticello` and `America/North_Dakota/Beulah`
 * above `Asia/Kolkata` — a list of 400 proper nouns needs "contains", with
 * a word that *starts* with the term ahead of one that merely contains it.
 */
function substringFilter(
  value: string,
  search: string,
  keywords?: string[],
): number {
  const term = search.trim().toLowerCase();
  if (!term) return 1;
  const haystack = [value, ...(keywords ?? [])].map((s) => s.toLowerCase());
  if (haystack.some((s) => s.split(/[\s/_]+/).some((w) => w.startsWith(term))))
    return 2;
  return haystack.some((s) => s.includes(term)) ? 1 : 0;
}

/**
 * A searchable select bound to the enclosing `form.AppField`.
 *
 * `SelectField` is a plain Radix select: fine for a dozen options, hopeless
 * for the ~420 IANA time zones it was first needed for (PAC-141). This is the
 * shadcn combobox recipe — `Popover` + `Command` — with client-side filtering
 * over `value`, `label` and `keywords`, so "central", "chicago" and "UTC−5"
 * all find `America/Chicago`.
 *
 * A stored value absent from `options` still renders on the trigger (as its
 * raw value) rather than reading as empty: the record is what it is, and a
 * field that silently shows "Select…" over a real value is how one gets
 * overwritten by accident.
 *
 * `CreateTicketDialog`'s `SearchableSelect` looks similar and is deliberately
 * not reused: it filters server-side (`shouldFilter={false}` + `onSearch`)
 * and is not bound to a form.
 */
export function ComboboxField<V extends string>({
  label,
  description,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No match.",
  disabled,
  className,
  triggerClassName,
  onChanged,
}: ComboboxFieldProps<V>) {
  const field = useFieldContext<V | undefined>();
  const error = useFieldError(field.state.meta);
  const [open, setOpen] = useState(false);

  const value = field.state.value;
  const selected = options.find((o) => o.value === value);

  const groups = useMemo(() => {
    const byGroup = new Map<string | undefined, ComboboxOption<V>[]>();
    for (const o of options) {
      const list = byGroup.get(o.group);
      if (list) list.push(o);
      else byGroup.set(o.group, [o]);
    }
    return [...byGroup.entries()];
  }, [options]);

  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            // Closing without choosing still counts as a visit, so a required
            // field that was opened and abandoned shows its error.
            if (!next) field.handleBlur();
          }}
        >
          {/*
            Deliberately NOT `asChild` + <Button>: the shadcn primitives are
            the React-19 build (no forwardRef) on a React 18 app, so slotting
            one in swallows Radix's ref and the popover loses its anchor. See
            the same note on `CreateTicketDialog`.
          */}
          <PopoverTrigger
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            disabled={disabled}
            className={cn(
              "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
              triggerClassName,
            )}
          >
            <span
              className={cn(
                "truncate text-left",
                !value && "text-muted-foreground",
              )}
            >
              {selected ? selected.label : (value ?? placeholder)}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </PopoverTrigger>
          <PopoverContent
            className="w-(--radix-popover-trigger-width) p-0"
            align="start"
          >
            <Command filter={substringFilter}>
              <CommandInput placeholder={searchPlaceholder} />
              <CommandList>
                <CommandEmpty>{emptyText}</CommandEmpty>
                {groups.map(([group, items]) => (
                  <CommandGroup key={group ?? ""} heading={group}>
                    {items.map((o) => (
                      <CommandItem
                        key={o.value}
                        value={o.value}
                        keywords={[o.label, ...(o.keywords ?? [])]}
                        onSelect={() => {
                          field.handleChange(o.value);
                          // A choice is final the moment it is made — mark it
                          // touched now, as `SelectField` does.
                          field.handleBlur();
                          onChanged?.(o.value);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "size-4",
                            o.value === value ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">{o.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </FieldShell>
  );
}
