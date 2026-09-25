import { ArrowRightLeft, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStartReplacement } from "../useStartReplacement";

interface PolicyReplacementActionsProps {
  policyId: string;
}

/**
 * Cancel & rewrite / Company transfer, as a pair (PAC-126).
 *
 * Shared by the policy detail page and the household policy card so the two
 * cannot drift — the same two actions, in the same order, starting the same
 * two-form chain.
 *
 * **Buttons, not links.** Where the rep lands depends on whether a lead was
 * already created for this replacement and then abandoned, and only the server
 * knows that. `useStartReplacement` asks, then routes to the Sold form or to the
 * New Lead form accordingly.
 *
 * The caller owns the permission gate and the active-policy check: the policy
 * page and the household card already load the policy and evaluate both, and
 * re-deriving them here would mean two answers to one question.
 */
export function PolicyReplacementActions({
  policyId,
}: PolicyReplacementActionsProps) {
  const rewrite = useStartReplacement(policyId, "cancel_rewrite");
  const transfer = useStartReplacement(policyId, "company_transfer");

  // Either in flight disables both: they navigate, and letting a rep start the
  // second while the first is resolving would race two redirects.
  const busy = rewrite.isStarting || transfer.isStarting;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={transfer.start}
        disabled={busy}
      >
        {transfer.isStarting ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <ArrowRightLeft aria-hidden className="size-4" />
        )}
        Company transfer
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={rewrite.start}
        disabled={busy}
      >
        {rewrite.isStarting ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <RefreshCw aria-hidden className="size-4" />
        )}
        Cancel &amp; rewrite
      </Button>
    </div>
  );
}
