import { ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStartReplacement } from "@/features/policy/useStartReplacement";

interface TicketTransferButtonProps {
  policyId: string;
}

/**
 * "Policy transfer" on a ticket, routed through the replacement chain (PAC-126).
 *
 * A Company Transfer used to be recorded *on* the ticket, through an endpoint
 * of its own. It now runs through the ordinary Sold form on a lead created for
 * it — New Lead → Sold form — so this button does what the policy page's does:
 * ask the server whether a lead was already created for this policy's transfer
 * and abandoned, then resume it or start one. A `<Link>` cannot express that,
 * which is why it is a button.
 *
 * The deal that results is anchored on the lead, not the ticket, so it does not
 * appear in the ticket's transfer panel below. That panel still renders every
 * transfer booked the old way.
 */
export function TicketTransferButton({ policyId }: TicketTransferButtonProps) {
  const { start, isStarting } = useStartReplacement(
    policyId,
    "company_transfer",
  );

  return (
    <Button size="sm" variant="outline" onClick={start} disabled={isStarting}>
      {isStarting ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : (
        <ArrowLeftRight aria-hidden className="size-4" />
      )}
      Policy transfer
    </Button>
  );
}
