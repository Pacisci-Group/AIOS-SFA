import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AddressSuggestion, StructuredAddress } from "@sfa/shared";
import { MapPin } from "lucide-react";
import { useFieldContext } from "@/hooks/form-context";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Input } from "@/components/ui/input";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import {
  MIN_ADDRESS_LOOKUP_LENGTH,
  autocompleteAddress,
  newAddressSessionToken,
  resolveAddress,
} from "@/lib/address-api";
import { cn } from "@/lib/utils";
import { FieldShell, useFieldError } from "./FieldShell";

/**
 * Latched once the API reports the integration unavailable.
 *
 * Module-level, not per-component, and deliberately: `available: false` means a
 * missing or revoked API key or an API not enabled on the project — none of
 * which will change while the page is open. Without the latch every address
 * field on the page would keep issuing a request per keystroke to be told the
 * same thing.
 *
 * Not reset anywhere. A page reload is the only thing that should clear it.
 */
let lookupUnavailable = false;

/** Google expires an autocomplete session server-side after ~3 minutes. */
const SESSION_MAX_AGE_MS = 150_000;

interface AddressAutocompleteFieldProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  placeholder?: string;
  /** DOM `disabled` only — never the library's, which nulls the value. */
  disabled?: boolean;
  /** On the wrapper, e.g. `sm:col-span-2`. */
  className?: string;
  /** On the `<input>`. Sites differ: the intake forms use `bg-card border-border`, the wizard doesn't. */
  inputClassName?: string;
  autoComplete?: string;
  /** Runs after the field's own blur. */
  onBlur?: () => void;
  /**
   * A prediction was chosen and resolved into four fields.
   *
   * This component owns **only** the street path, so the caller writes the
   * siblings — it is the only thing that knows their paths. See `AddressFields`,
   * which is the one place in the app that names all four.
   */
  onAddressSelected: (address: StructuredAddress) => void;
  /** Share-link token on the public intake form; `undefined` = authenticated. */
  shareToken?: string;
}

/**
 * The street line of an address, with Google-backed predictions (PAC-60).
 *
 * Bound to a single path like every other field component — the path comes from
 * `name` on `AppField` at the call site, and this never knows or hardcodes one.
 * Filling in city/state/zip is emphatically *not* done here: a field component
 * that reached for its siblings would have to name them, which is the exact
 * defect this tier exists to prevent. It emits a resolved address and lets
 * `AddressFields` do the writing.
 *
 * ## Free text always wins
 * Typing an address Google has never heard of is a completely normal thing to
 * do — rural routes and new builds are exactly the addresses it does not know,
 * and they are exactly the leads this agency cannot afford to lose. So the
 * dropdown is an offer, never a gate: nothing here writes validation state, and
 * the value is whatever the user typed unless they actively pick a suggestion.
 *
 * ## Why the list is not portaled
 * `CommandList` sits inside the `Command` root in the normal DOM rather than in
 * a `PopoverContent`. Two reasons, both learned the hard way elsewhere in this
 * codebase: cmdk registers items by walking the DOM beneath its root, so a
 * portal boundary breaks item registration; and a portaled popover fights the
 * focus trap of the `Sheet`/`Dialog` these fields render inside (see the
 * `modal` workaround in `CreateTicketDialog`). Keeping one subtree also avoids
 * `asChild`, which swallows Radix's ref because the shadcn primitives here are
 * the React-19 build while the app runs React 18.
 */
export function AddressAutocompleteField({
  label,
  description,
  placeholder,
  disabled,
  className,
  inputClassName,
  autoComplete,
  onBlur,
  onAddressSelected,
  shareToken,
}: AddressAutocompleteFieldProps) {
  const field = useFieldContext<string | undefined>();
  const error = useFieldError(field.state.meta);
  const listId = useId();

  const value = field.state.value ?? "";
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  /**
   * The current billing session. One per mounted address block, so the
   * household card and a policy drawer run separate sessions — which is
   * correct, they are separate address entries.
   */
  const session = useRef<{ id: string; startedAt: number } | null>(null);

  /**
   * The last value written by picking a suggestion.
   *
   * Without it, `onAddressSelected` writing the street back into this field
   * would look like fresh typing and immediately reopen the dropdown on the
   * address the user just chose.
   */
  const justSelected = useRef<string | null>(null);

  const debounced = useDebouncedValue(value, 250);

  const currentSession = useCallback(() => {
    const now = Date.now();
    if (!session.current || now - session.current.startedAt > SESSION_MAX_AGE_MS) {
      session.current = { id: newAddressSessionToken(), startedAt: now };
    }
    return session.current.id;
  }, []);

  useEffect(() => {
    if (lookupUnavailable || disabled) return;

    const term = debounced.trim();
    if (term.length < MIN_ADDRESS_LOOKUP_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      // An emptied field ends the session — the next entry is a new address.
      if (!term) session.current = null;
      return;
    }
    if (justSelected.current === term) return;

    // Guards against an out-of-order response overwriting a newer one. The user
    // types faster than the network answers.
    let live = true;
    void autocompleteAddress(term, currentSession(), shareToken)
      .then((res) => {
        if (!live) return;
        if (!res.available) {
          lookupUnavailable = true;
          setSuggestions([]);
          setOpen(false);
          return;
        }
        setSuggestions(res.suggestions);
        setActiveIndex(0);
        setOpen(res.suggestions.length > 0);
      })
      .catch(() => {
        // Never surfaced. A failed lookup is a missing convenience, not an
        // error the person filling in the form can do anything about, and this
        // fires on a keystroke — a toast per keystroke would be its own bug.
        if (live) setSuggestions([]);
      });

    return () => {
      live = false;
    };
  }, [debounced, disabled, shareToken, currentSession]);

  const choose = useCallback(
    (suggestion: AddressSuggestion) => {
      setOpen(false);
      justSelected.current = suggestion.primaryText;
      // Optimistic: show the chosen line immediately rather than leaving the
      // half-typed text sitting there while Place Details round-trips.
      field.handleChange(suggestion.primaryText);

      const token = currentSession();
      void resolveAddress(suggestion.placeId, token, shareToken)
        .then((res) => {
          if (!res.available) lookupUnavailable = true;
          if (res.address) {
            justSelected.current = res.address.street;
            onAddressSelected(res.address);
          }
        })
        .catch(() => {
          // The street line is already in place from the optimistic write, so
          // the user is no worse off than if they had typed it.
        })
        .finally(() => {
          // Terminated, whatever the outcome. Reusing a spent token would get
          // the next batch of keystrokes billed standalone.
          session.current = null;
        });
    },
    [field, currentSession, onAddressSelected, shareToken],
  );

  const showList = open && suggestions.length > 0;

  return (
    <FieldShell
      label={label}
      description={description}
      error={error}
      className={className}
    >
      {({ id, describedBy, invalid }) => (
        <Command
          // cmdk would otherwise re-filter server-side results against the
          // input, hiding predictions Google deliberately returned.
          shouldFilter={false}
          loop
          className="relative overflow-visible bg-transparent"
        >
          <Input
            id={id}
            role="combobox"
            aria-expanded={showList}
            aria-controls={showList ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              showList ? `${listId}-${activeIndex}` : undefined
            }
            autoComplete={autoComplete}
            placeholder={placeholder}
            disabled={disabled}
            className={inputClassName}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={value}
            onChange={(e) => {
              justSelected.current = null;
              field.handleChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (!showList) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % suggestions.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex(
                  (i) => (i - 1 + suggestions.length) % suggestions.length,
                );
              } else if (e.key === "Enter") {
                // Only while a suggestion is highlighted — Enter on a free-typed
                // address must still submit the form, not get swallowed here.
                e.preventDefault();
                choose(suggestions[activeIndex]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            onBlur={() => {
              /*
               * Deferred past the click that may have caused it: closing the
               * list synchronously on blur unmounts the item before its
               * `onSelect` fires, so clicking a suggestion would do nothing.
               */
              window.setTimeout(() => setOpen(false), 150);
              field.handleBlur();
              onBlur?.();
            }}
          />

          {showList ? (
            <CommandList
              id={listId}
              className={cn(
                "absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-border",
                "bg-popover text-popover-foreground shadow-md max-h-56",
              )}
            >
              {suggestions.map((s, i) => (
                <CommandItem
                  key={s.placeId}
                  id={`${listId}-${i}`}
                  value={s.placeId}
                  onMouseEnter={() => setActiveIndex(i)}
                  onSelect={() => choose(s)}
                  className={cn(
                    "cursor-pointer gap-2",
                    i === activeIndex && "bg-accent text-accent-foreground",
                  )}
                >
                  <MapPin className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{s.primaryText}</span>
                    {s.secondaryText ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.secondaryText}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          ) : null}
        </Command>
      )}
    </FieldShell>
  );
}
