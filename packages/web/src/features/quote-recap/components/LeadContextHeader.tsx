import type { QuoteRecapLeadContext } from "@sfa/shared";
import { AlertTriangle } from "lucide-react";
import { statusBadgeClass } from "@/features/lead/components/lead-display";
import { cn } from "@/lib/utils";

interface LeadContextHeaderProps {
  context: QuoteRecapLeadContext;
}

function formatAddress(
  address: QuoteRecapLeadContext["householdAddress"],
): string {
  if (!address) return "—";
  const line = [address.street, address.city, address.state, address.zip]
    .filter(Boolean)
    .join(", ");
  return line || "—";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}

/**
 * Read-only confirmation of who this recap is for.
 *
 * The producer reaches this form from a row action, so the one thing worth
 * guarding against is recapping the wrong household — hence real names and a
 * real address rather than the prototype's raw `householdId` hash.
 */
export function LeadContextHeader({ context }: LeadContextHeaderProps) {
  return (
    <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Quoting for
        </h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            statusBadgeClass(context.leadStatus),
          )}
        >
          {context.leadStatus}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Primary contact" value={context.primaryContactName} />
        <Field label="Household" value={context.householdName ?? "—"} />
        <div className="sm:col-span-2">
          <Field
            label="Household address"
            value={formatAddress(context.householdAddress)}
          />
        </div>
      </div>

      {!context.householdId && (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-500"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            This lead isn’t linked to a household yet, so a quote recap can’t be
            recorded against it.
          </span>
        </div>
      )}
    </section>
  );
}
