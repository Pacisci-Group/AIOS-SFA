import type { QuoteRecapLeadContext } from "@sfa/shared";
import { AlertTriangle } from "lucide-react";
import { FormGrid, FormSection } from "@/components/form";
import { statusBadgeClass } from "@/features/lead/components/lead-display";
import { formatAddress } from "@/lib/format-address";
import { cn } from "@/lib/utils";

interface LeadContextHeaderProps {
  context: QuoteRecapLeadContext;
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
    <FormSection
      title="Quoting for"
      action={
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            statusBadgeClass(context.leadStatus),
          )}
        >
          {context.leadStatus}
        </span>
      }
    >
      <FormGrid>
        <Field label="Primary contact" value={context.primaryContactName} />
        <Field label="Household" value={context.householdName ?? "—"} />
        <div className="sm:col-span-2">
          <Field
            label="Household address"
            value={formatAddress(context.householdAddress) ?? "—"}
          />
        </div>
      </FormGrid>

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
    </FormSection>
  );
}
