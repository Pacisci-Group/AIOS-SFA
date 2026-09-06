import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Makes a **disabled** control's explanation actually reachable.
 *
 * `components/ui/button.tsx` carries `disabled:pointer-events-none` in its base
 * `cva`. An element with `pointer-events: none` is not hit-tested, so the
 * browser never fires the hover that would show its own `title` — a `title` on a
 * disabled `Button` is dead markup. Radix's `Tooltip` fails for the same reason:
 * its trigger never sees the pointer either.
 *
 * Wrapping the button in an element that *does* receive pointer events fixes
 * both halves: the pointer event falls through the button to this span, and the
 * browser walks up the ancestor chain to find the `title`.
 *
 * This only renders the wrapper when there is a hint to show, so an **enabled**
 * control is never given an ancestor `title` it would then inherit a tooltip
 * from.
 *
 * ⚠ A pointer-events-none child also cannot be focused by mouse, and a disabled
 * button is already out of the tab order — so this is a mouse-only affordance,
 * as the native `title` always was. Where the reason must reach a keyboard or
 * screen-reader user, state it in visible copy instead (as `RenewalPanel` does
 * with "Tick every policy as you cover it…").
 */
export function DisabledHint({
  hint,
  className,
  children,
}: {
  /** Why the control is unavailable. No hint ⇒ no wrapper. */
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!hint) return <>{children}</>;

  return (
    <span title={hint} className={cn("inline-flex", className)}>
      {children}
    </span>
  );
}
