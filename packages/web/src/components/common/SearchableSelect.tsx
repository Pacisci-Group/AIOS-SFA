import { useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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

/*
 * A combobox over a **remote** search — the ticket dialog's household, policy
 * and CRM pickers, and the 1-800 service intake's "Existing client?" search
 * (PAC-173 PR 5). Moved here from `CreateTicketDialog` when the second caller
 * arrived. Not a form field: it is value/onChange, so a form binds it through
 * its own field. `ComboboxField` is the form-bound one, and filters a fixed
 * list in the browser instead.
 */

export interface SearchableOption {
  value: string;
  label: string;
  hint?: string;
}


/**
 * Combobox over a remote list. `onSearch` receives the typed term so the caller
 * can refetch; filtering therefore happens server-side, not in `Command`.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  onSearch,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  loading,
  disabled,
  id,
}: {
  options: SearchableOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  onSearch: (term: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  loading?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    // `modal` matters here: the popover is portaled outside the dialog, so
    // without its own modal layer the dialog's focus trap steals focus back
    // from the search input.
    <Popover open={open} onOpenChange={setOpen} modal>
      {/*
        Deliberately NOT `asChild` + <Button>. These shadcn components are the
        React-19 build (no forwardRef) while the app runs React 18, so slotting
        one in swallows Radix's ref — the popover then has no anchor and renders
        off-screen. Styling the primitive directly keeps the ref intact.
      */}
      <PopoverTrigger
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            onValueChange={onSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching…
              </div>
            ) : (
              <CommandEmpty>{emptyLabel}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    // Selecting the current value clears it.
                    onChange(option.value === value ? null : option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-3.5 w-3.5 ${
                      option.value === value ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.hint && (
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Put a prefilled record at the head of a search result list.
 *
 * The pickers render only what the search returned, so a prefilled household
 * that happens not to match the empty-term search would select an option that
 * does not exist and display as unselected. A no-op when the search already
 * found it, or when there is nothing prefilled.
 */
export function pinOption(
  options: SearchableOption[],
  value?: string | null,
  label?: string,
): SearchableOption[] {
  if (!value || options.some((o) => o.value === value)) return options;
  return [{ value, label: label ?? value }, ...options];
}
