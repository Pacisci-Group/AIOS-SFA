import { ModuleKey } from "@sfa/shared";
import { Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";

/** Route owning the Quote Recap edit form (PAC-56 #11). */
export function editQuoteRecapRoute(recapId: string): string {
  return `/quote-recaps/${encodeURIComponent(recapId)}/edit`;
}

interface EditQuoteRecapActionProps {
  recapId: string;
}

/**
 * The Quote Summary card's edit entry point.
 *
 * Self-gates on `quote_recaps:write` and renders nothing without it, so
 * `QuoteRecapCard` takes no permission dependency — the same contract as
 * `QuoteRecapAction`, `EditPolicyDialog` and `EditContactDialog`.
 *
 * Styled to match `EditPolicyDialog`'s trigger on the Sold card directly below
 * it: the two are the same affordance on the same page, and a producer should
 * not have to work out that they are.
 */
export function EditQuoteRecapAction({ recapId }: EditQuoteRecapActionProps) {
  const { canWrite } = usePermissions();
  if (!canWrite(ModuleKey.QuoteRecaps)) return null;

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground"
    >
      <Link to={editQuoteRecapRoute(recapId)} aria-label="Edit quote recap">
        <Pencil />
        Edit
      </Link>
    </Button>
  );
}
