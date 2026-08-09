import { ModuleKey } from "@sfa/shared";
import { CheckCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Route owning the Sold form (PAC-40, story 5 of the Leads epic). */
export const NEW_SOLD_DEAL_ROUTE = "/sold/new";

export function newSoldDealRoute(leadId: string, quoteRecapId?: string): string {
  const params = new URLSearchParams({ leadId });
  // Optional throughout: not every sale has a recorded quote.
  if (quoteRecapId) params.set("quoteRecapId", quoteRecapId);
  return `${NEW_SOLD_DEAL_ROUTE}?${params.toString()}`;
}

interface SoldDealActionProps {
  leadId: string;
  /** Used in the accessible name, e.g. "Mark Dana Ruiz as sold". */
  leadName?: string;
  quoteRecapId?: string;
  className?: string;
}

/**
 * The single "Mark as Sold" entry point.
 *
 * Gates on `deal_audits:write` — the permission the sold write path itself
 * requires, because a Producer's role template grants no `clients:*`. Rendering
 * a button that would 403 on submit is worse than not rendering it.
 *
 * Mirrors `QuoteRecapAction` so both lead actions stay consistent — same
 * `Button asChild` construction, same `size="sm"`, so the pair lines up. The
 * `success` variant replaces a hard-coded `bg-emerald-600 text-white`, which was
 * a dark-only pair that never re-themed.
 */
export function SoldDealAction({
  leadId,
  leadName,
  quoteRecapId,
  className,
}: SoldDealActionProps) {
  const { canWrite } = usePermissions();
  if (!canWrite(ModuleKey.DealAudits)) return null;

  return (
    <Button
      asChild
      variant="success"
      size="sm"
      // `relative z-10` lifts it above any stretched row link whose ::after
      // covers the whole row.
      className={cn("relative z-10", className)}
    >
      <Link
        to={newSoldDealRoute(leadId, quoteRecapId)}
        onClick={(e) => e.stopPropagation()}
        aria-label={leadName ? `Mark ${leadName} as sold` : "Mark as sold"}
      >
        <CheckCircle />
        Mark as Sold
      </Link>
    </Button>
  );
}
