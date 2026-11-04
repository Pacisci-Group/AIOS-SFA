import type { PeopleStatus } from "@sfa/shared";
import { cn } from "@/lib/utils";
import { STATUS_BADGE, STATUS_FACET_ORDER } from "./person-display";

/**
 * The Status facet of the People list (PAC-162): four toggle chips, ORed,
 * applied as they are clicked — no Apply button, the product rule for every
 * facet. None selected means everyone. The same bordered-pill treatment as
 * the Leads scope toggle, so the two lists read as one app.
 */
export function StatusFacet({
  value,
  onChange,
}: {
  value: PeopleStatus[];
  onChange: (next: PeopleStatus[]) => void;
}) {
  const toggle = (status: PeopleStatus) =>
    onChange(
      value.includes(status)
        ? value.filter((entry) => entry !== status)
        : [...value, status],
    );

  return (
    <div
      role="group"
      aria-label="Filter by status"
      className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1"
    >
      {STATUS_FACET_ORDER.map((status) => {
        const on = value.includes(status);
        return (
          <button
            key={status}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(status)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              on
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {STATUS_BADGE[status].label}
          </button>
        );
      })}
    </div>
  );
}
