import { ModuleKey } from "@sfa/shared";
import { Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";

/** Route owning the Edit sale page (PAC-104). */
export function editSoldDealRoute(dealId: string): string {
  return `/sold/${encodeURIComponent(dealId)}/edit`;
}

interface EditSaleActionProps {
  dealId: string;
}

/**
 * The Sold card's entry to the Edit sale page — the sold date, and adding a
 * policy to the deal (PAC-104).
 *
 * Self-gates on `deal_audits:write`, the permission booking the sale requires,
 * and renders nothing without it — the same contract as `EditQuoteRecapAction`
 * and `EditPolicyDialog`, so `SoldCard` takes no permission dependency.
 */
export function EditSaleAction({ dealId }: EditSaleActionProps) {
  const { canWrite } = usePermissions();
  if (!canWrite(ModuleKey.DealAudits)) return null;

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground"
    >
      <Link to={editSoldDealRoute(dealId)} aria-label="Edit sale">
        <Pencil />
        Edit sale
      </Link>
    </Button>
  );
}
