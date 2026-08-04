import { ModuleKey } from "@sfa/shared";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";

/** Route owning the Quote Recap form (PAC-39, story 4 of the Leads epic). */
export const NEW_QUOTE_RECAP_ROUTE = "/quote-recaps/new";

export function newQuoteRecapRoute(leadId: string): string {
  return `${NEW_QUOTE_RECAP_ROUTE}?leadId=${encodeURIComponent(leadId)}`;
}

interface QuoteRecapActionProps {
  leadId: string;
  /** Used in the accessible name, e.g. "Record quote recap for Dana Ruiz". */
  leadName?: string;
  className?: string;
}

/**
 * The single "Quote Recap" entry point, shared by the Leads table/cards and the
 * Lead Detail header, so all three stay in sync.
 *
 * Gates itself on `quote_recaps:write` and renders nothing without it — callers
 * don't need their own permission check. (Mirrors `AddLeadButton`.)
 */
export function QuoteRecapAction({
  leadId,
  leadName,
  className,
}: QuoteRecapActionProps) {
  const { canWrite } = usePermissions();
  if (!canWrite(ModuleKey.QuoteRecaps)) return null;

  return (
    <Link
      to={newQuoteRecapRoute(leadId)}
      // `relative z-10` lifts it above the stretched row link in LeadsTable /
      // LeadCard, whose ::after covers the whole row.
      onClick={(e) => e.stopPropagation()}
      aria-label={
        leadName ? `Record quote recap for ${leadName}` : "Record quote recap"
      }
      className={cn(
        "relative z-10 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10 transition-colors",
        className,
      )}
    >
      <FileText size={14} />
      <span className="hidden lg:inline">Quote</span>
    </Link>
  );
}
