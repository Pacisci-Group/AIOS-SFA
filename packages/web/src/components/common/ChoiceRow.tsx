import { cn } from "@/lib/utils";

/**
 * One selectable row in a short, two-line radio list.
 *
 * Shared by the two places PAC-91 §7 asks "who leads this household?" — the
 * succession step inside the contact edit modal, and the Household page's
 * "change primary contact" dialog. They ask the same question about the same
 * records, so they look the same on purpose.
 *
 * A `button` with `role="radio"` rather than a native `<input type="radio">`:
 * the row is the whole hit target and carries a title plus a caption, which a
 * native radio's label cannot style without fighting the browser's own layout.
 * Keyboard behaviour is the button's, so Space/Enter select — the arrow-key
 * roving a native group gives for free is the trade, and it is the smaller loss
 * for a list this short. Wrap a set in an element with
 * `role="radiogroup"` and an accessible name.
 */
export function ChoiceRow({
  selected,
  onSelect,
  title,
  caption,
  disabled = false,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  caption: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-primary bg-primary/8"
          : "border-border bg-muted enabled:hover:bg-accent",
      )}
    >
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </button>
  );
}
