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
 * The amber is the design's error colour — `--destructive` is `#F59E0B`, i.e.
 * `amber-500` — so these tints are on-token despite naming a palette value.
 * They are written out rather than `bg-destructive/10` only because the border
 * and text opacities differ; revisit when the light theme lands, which is the
 * point at which these three values need real light-mode equivalents.
 */
export function FormError({ children, icon }: FormErrorProps) {
  if (!children) return null;

  if (icon) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
      >
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-500" />
        {children}
      </p>
    );
  }

  return (
    <div
      role="alert"
      className="px-4 py-3 rounded-lg text-sm bg-amber-500/10 border border-amber-500/25 text-amber-500"
    >
      {children}
    </div>
  );
}
