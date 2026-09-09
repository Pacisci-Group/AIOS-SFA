import { Check, X } from "lucide-react";

/**
 * A live "is this free?" hint under a field.
 *
 * A hint, not a validation message — it renders nothing while unknown, and the
 * form is never blocked on it. The server is the authority and re-checks on
 * submit; this exists so the operator finds out on the step that owns the field
 * rather than after pressing Create.
 */
export function AvailabilityHint({
  available,
  takenLabel,
  freeLabel,
}: {
  available: boolean | null;
  takenLabel: string;
  freeLabel: string;
}) {
  if (available === null) return null;
  return (
    <p
      className={
        "flex items-center gap-1.5 text-xs " +
        (available ? "text-success" : "text-destructive")
      }
    >
      {available ? <Check size={12} /> : <X size={12} />}
      {available ? freeLabel : takenLabel}
    </p>
  );
}
