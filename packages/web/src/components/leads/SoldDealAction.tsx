import { ModuleKey, isSoldLeadStatus } from "@sfa/shared";
import { CheckCircle } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { LeadActionButton } from "./LeadActionButton";

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
  /** The lead's current status (PAC-56 #17). Required — see `QuoteRecapAction`. */
  leadStatus: string;
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
 * ## The two gates (PAC-56 #17)
 *
 * 1. **No quote recap ⇒ disabled.** A sale has to be preceded by a recorded
 *    quote, so the pipeline reads Lead → Quote → Sold rather than producers
 *    jumping straight to the end and back-filling. `quoteRecapId` being absent
 *    *is* "no recap on file" — the Lead Detail header passes
 *    `lead.latestQuoteRecap?.id`.
 * 2. **Already sold ⇒ disabled**, along with the Quote button, so a second deal
 *    is not booked on the same lead by habit.
 *
 * Both are affordances. The API deliberately does **not** reject either case:
 * `AdvanceLeadStep` is idempotent so a `submissionToken` replay can self-heal a
 * create whose follow-up died, and a genuine second deal on the same household
 * later is legitimate. Blocking those server-side would trade a real guarantee
 * for a UI rule. `SoldDealPage` blocks the same two cases so a typed URL cannot
 * walk around the button.
 *
 * Mirrors `QuoteRecapAction` so both lead actions stay consistent — same
 * construction, same `size="sm"`, so the pair lines up. The `success` variant
 * replaces a hard-coded `bg-emerald-600 text-white`, which was a dark-only pair
 * that never re-themed.
 */
export function SoldDealAction({
  leadId,
  leadStatus,
  leadName,
  quoteRecapId,
  className,
}: SoldDealActionProps) {
  const { canWrite } = usePermissions();
  if (!canWrite(ModuleKey.DealAudits)) return null;

  const disabledReason = isSoldLeadStatus(leadStatus)
    ? "This lead is already sold."
    : !quoteRecapId
      ? "Record a quote first."
      : undefined;

  return (
    <LeadActionButton
      to={newSoldDealRoute(leadId, quoteRecapId)}
      accessibleName={leadName ? `Mark ${leadName} as sold` : "Mark as sold"}
      variant="success"
      size="sm"
      className={className}
      disabledReason={disabledReason}
    >
      <CheckCircle />
      Mark as Sold
    </LeadActionButton>
  );
}
