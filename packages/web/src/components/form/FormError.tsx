import { AlertCircle } from "lucide-react";

interface FormErrorProps {
  /** Nothing renders when this is empty, so callers drop their own ternary. */
  children?: React.ReactNode;
  /** Adds the leading alert icon, as the Sold wizard does. */
  icon?: boolean;
}

/**
 * A submit-level error banner — the message that comes back from the server,
 * not a field validation message (that is `FormMessage`'s job).
 *
 * Deliberately not shadcn's `ui/alert.tsx`: its `destructive` variant is
 * `bg-card text-destructive` with no tint and no tinted border, so it is not a
 * drop-in for this treatment.
 *
 * The amber is the design's error colour, so the base tints are `--destructive`
 * at three opacities — in light that resolves to amber-700, because amber-500
 * text on a white card is about 2:1.
 *
 * The `dark:` overrides keep the literal `amber-500` this used to name, and are
 * not redundant: Tailwind v4 defines `amber-500` as `oklch(0.769 0.188 70.08)`,
 * which is *not* quite `--destructive`'s `#F59E0B`. Measured over `bg-card`,
 * dropping the literal shifted the text by rgb(9,4,11) — small, but this
 * component's dark rendering is meant to be untouched by the light-theme work,
 * so it is pinned. Collapse these to the token alone if that shift is ever
 * deemed acceptable.
 */
export function FormError({ children, icon }: FormErrorProps) {
  if (!children) return null;

  if (icon) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground dark:border-amber-500/40 dark:bg-amber-500/10"
      >
        <AlertCircle
          size={16}
          className="mt-0.5 shrink-0 text-destructive dark:text-amber-500"
        />
        {children}
      </p>
    );
  }

  return (
    <div
      role="alert"
      className="px-4 py-3 rounded-lg text-sm bg-destructive/10 border border-destructive/25 text-destructive dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-500"
    >
      {children}
    </div>
  );
}
