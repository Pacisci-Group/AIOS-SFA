import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The search box above a paginated table (PAC-101).
 *
 * This markup was copy-pasted seven times — a `relative` wrapper, an absolutely
 * positioned `Search` icon, and an `<Input className="pl-9">` — and the copies
 * had drifted: four of the seven had no `aria-label`, and none of them showed
 * that a search was in flight.
 *
 * ## Why the debounce is *not* in here
 *
 * The obvious design owns the value and debounces it internally. It does not
 * fit: two of the five tables keep their query in the **URL**
 * (`useLeadsUrlState`, `useHouseholdsUrlState`) rather than in local state, so
 * a component that owned it would have to hand the debounced value back out —
 * an awkward second channel, and one that hides where the query actually lives.
 *
 * So the value stays with whoever owns it and this stays presentational. What
 * it does own is the part that was genuinely inconsistent: the markup, the
 * label, the busy affordance, and the {@link SEARCH_DEBOUNCE_MS} constant the
 * five call sites were spelling out as a literal.
 */
export interface TableSearchInputProps {
  /** The live value — what the user is typing, not the debounced one. */
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  /**
   * The accessible name. Required rather than optional: it was missing on four
   * of the seven boxes this replaces, which is what an optional prop gets you.
   */
  label: string;
  /**
   * Whether a request is in flight. Every one of these tables uses
   * `keepPreviousData`, so during a refetch the previous page stays on screen
   * with nothing to say why — between a 300ms debounce and a round trip the
   * table simply looks stale. `isFetching` was already computed at every call
   * site and used only to disable Prev/Next.
   */
  busy?: boolean;
  className?: string;
}

/** The delay every table's search box uses. One constant, not five literals. */
export const SEARCH_DEBOUNCE_MS = 300;

export function TableSearchInput({
  value,
  onValueChange,
  placeholder,
  label,
  busy = false,
  className,
}: TableSearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        // `aria-busy` rather than a `role="status"` live region: the result is
        // the table below, and announcing "searching" on every keystroke would
        // talk over the results a screen-reader user is trying to read.
        aria-busy={busy}
        className="border-border bg-card pl-9"
      />
      {busy && (
        <Loader2
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      )}
    </div>
  );
}
