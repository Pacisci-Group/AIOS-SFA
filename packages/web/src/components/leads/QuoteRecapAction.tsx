import { ModuleKey } from "@sfa/shared";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
 * Built from `Button asChild` rather than a bare styled `<Link>`: it sits beside
 * `SoldDealAction` and the two have to match in height, radius, icon size and
 * focus ring. Hand-rolling both is how they drifted into "one looks like a
 * button and the other doesn't".
 */
export function QuoteRecapAction({
  leadId,
  leadName,
  iconOnly = false,
  className,
}: QuoteRecapActionProps) {
  const { canWrite } = usePermissions();
  if (!canWrite(ModuleKey.QuoteRecaps)) return null;

  const accessibleName = leadName
    ? `Record quote recap for ${leadName}`
    : "Record quote recap";

  const button = (
    <Button
      asChild
      variant="outline"
      size={iconOnly ? "icon-sm" : "sm"}
      // `relative z-10` lifts it above the stretched row link in LeadsTable /
      // LeadCard, whose ::after covers the whole row.
      className={cn("relative z-10", className)}
    >
      <Link
        to={newQuoteRecapRoute(leadId)}
        onClick={(e) => e.stopPropagation()}
        aria-label={accessibleName}
      >
        <FileText />
        {!iconOnly && "Quote"}
      </Link>
    </Button>
  );

  if (!iconOnly) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{accessibleName}</TooltipContent>
    </Tooltip>
  );
}
