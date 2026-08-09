import { ModuleKey, isSoldLeadStatus } from "@sfa/shared";
import { FileText } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { LeadActionButton } from "./LeadActionButton";

/** Route owning the Quote Recap form (PAC-39, story 4 of the Leads epic). */
export const NEW_QUOTE_RECAP_ROUTE = "/quote-recaps/new";

export function newQuoteRecapRoute(leadId: string): string {
  return `${NEW_QUOTE_RECAP_ROUTE}?leadId=${encodeURIComponent(leadId)}`;
}

interface QuoteRecapActionProps {
  leadId: string;
  /**
   * The lead's current status (PAC-56 #17). **Required, not optional** — these
   * components are deliberately self-gating, and a required prop is what makes
   * every call site a compile error rather than a surface that quietly keeps
   * the old behaviour.
   */
  leadStatus: string;
  /** Used in the accessible name, e.g. "Record quote recap for Dana Ruiz". */
  leadName?: string;
  /**
   * Drop the label and render the icon alone, with the name on a tooltip.
   *
   * For the Leads table and mobile card, where the actions cell is 140px and a
   * labelled button would push the row. The Lead Detail header leaves this off:
   * that is where the control has to read as a button beside "Mark as Sold",
   * and an unlabelled icon is exactly what made it look like neither.
   */
  iconOnly?: boolean;
  className?: string;
}

/**
 * The single "Quote Recap" entry point, shared by the Leads table/cards and the
 * Lead Detail header, so all three stay in sync.
 *
 * Gates itself on `quote_recaps:write` and renders nothing without it — callers
 * don't need their own permission check. (Mirrors `AddLeadButton`.)
 *
 * Disabled once the lead is **sold** (PAC-56 #17): quoting a closed deal is
 * always a mis-click, and the recap it would create sits confusingly beside the
 * sale on Lead Detail. Note this is a UI affordance — the API still accepts a
 * recap on a sold lead, deliberately, because a late correction is legitimate.
 */
export function QuoteRecapAction({
  leadId,
  leadStatus,
  leadName,
  iconOnly = false,
  className,
}: QuoteRecapActionProps) {
  const { canWrite } = usePermissions();
  if (!canWrite(ModuleKey.QuoteRecaps)) return null;

  const accessibleName = leadName
    ? `Record quote recap for ${leadName}`
    : "Record quote recap";

  return (
    <LeadActionButton
      to={newQuoteRecapRoute(leadId)}
      accessibleName={accessibleName}
      variant="outline"
      size={iconOnly ? "icon-sm" : "sm"}
      className={className}
      disabledReason={
        isSoldLeadStatus(leadStatus)
          ? "This lead is already sold."
          : undefined
      }
      tooltip={iconOnly ? accessibleName : undefined}
    >
      <FileText />
      {!iconOnly && "Quote"}
    </LeadActionButton>
  );
}
