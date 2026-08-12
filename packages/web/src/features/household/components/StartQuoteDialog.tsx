import type { HouseholdView } from "@sfa/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { openLeadServiceTicket } from "@/lib/leads-api";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { householdLeadsKey, StartQuoteLeadStep } from "./StartQuoteLeadStep";
import { StartQuoteRecapStep } from "./StartQuoteRecapStep";

const STEPS = [
  { title: "Choose a lead", description: "Which enquiry is this quote for?" },
  {
    title: "Quote recap",
    description: "What was quoted, and for how much.",
  },
] as const;

interface StartQuoteDialogProps {
  household: HouseholdView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Start Quote" on the Household page — a two-step dialog rather than a jump to
 * `/quote-recaps/new`.
 *
 * The first step exists because **a quote recap belongs to a lead**, not to a
 * household and not to a service ticket. A household can be quoted many times
 * over its life (a cross-sell, a re-quote at renewal), and each of those is its
 * own lead carrying its own pipeline and its own producer. Starting from the
 * client page, that answer is genuinely unknown, so the dialog asks rather than
 * picking the most recent lead and hoping.
 *
 * It is a dialog and not a route because the producer is *reading the client* —
 * the policy list they are quoting against is on the page behind it, and
 * navigating away to come back is the interaction the mockup's quick-action bar
 * exists to avoid. `/quote-recaps/new?leadId=` remains the entry point from
 * Lead Detail, where the lead is already known and step 1 would be a question
 * with one answer.
 */
export function StartQuoteDialog({
  household,
  open,
  onOpenChange,
}: StartQuoteDialogProps) {
  const queryClient = useQueryClient();
  const [leadId, setLeadId] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState(false);

  // Reset on open so a cancelled run never resurfaces mid-flow in the next one.
  // On *open* rather than on close: the closing dialog animates out, and
  // clearing the step there would flip it back to step 1 while it is still on
  // screen.
  useEffect(() => {
    if (open) {
      setLeadId(null);
      setTicketError(false);
    }
  }, [open]);

  /**
   * Open the lead's service ticket on the way to step 2, so a quote in flight
   * is visible on the CSR desk from the moment it starts.
   *
   * Runs for a lead just created *and* for one picked off the list — the call is
   * idempotent server-side, so the second case is a no-op rather than a second
   * ticket.
   *
   * **Advances to step 2 either way.** The quote recap is what the producer came
   * here to write, and the ticket is bookkeeping around it; blocking the form on
   * a failed ticket write would trade the valuable half of this flow for the
   * cheap half. The failure is surfaced instead of swallowed — `POST /leads/:id`
   * is idempotent, so reopening the dialog on the same lead retries it.
   */
  const handleLeadChosen = useCallback(
    (chosenLeadId: string) => {
      setTicketError(false);
      // Advance first, then fire the write — step 2 must not wait on it.
      setLeadId(chosenLeadId);
      openLeadServiceTicket(chosenLeadId)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
        })
        .catch(() => setTicketError(true));
    },
    [queryClient],
  );

  const stepIndex = leadId ? 1 : 0;
  const step = STEPS[stepIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Wider and height-capped: step 2 is the full Quote Recap form, which is
        taller than any viewport once a few policies are on it. The body scrolls
        inside the dialog so the header — which is the only thing telling the
        producer where they are — stays put.
      */}
      <DialogContent className="grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="gap-3 border-b border-border px-6 py-4">
          {/* `pr-8` clears the dialog's own close button, which is absolutely
              positioned at `top-4 right-4` over this row. */}
          <div className="flex items-baseline justify-between gap-3 pr-8">
            <DialogTitle>{step.title}</DialogTitle>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Step {stepIndex + 1} of {STEPS.length}
            </p>
          </div>
          <DialogDescription>
            {step.description} · {household.name ?? "This household"}
          </DialogDescription>
          <Progress
            value={((stepIndex + 1) / STEPS.length) * 100}
            aria-label={`Step ${stepIndex + 1} of ${STEPS.length}: ${step.title}`}
          />
        </DialogHeader>

        <div className="overflow-y-auto px-6 py-5">
          {ticketError && (
            <p
              role="status"
              className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              The service ticket for this lead could not be opened. The quote
              recap below still saves normally — reopen Start Quote on this lead
              afterwards to retry the ticket.
            </p>
          )}
          {leadId === null ? (
            <StartQuoteLeadStep
              household={household}
              onLeadChosen={handleLeadChosen}
              onCancel={() => onOpenChange(false)}
            />
          ) : (
            <StartQuoteRecapStep
              leadId={leadId}
              onBack={() => setLeadId(null)}
              onDone={() => {
                // A recap moves the lead to "Quoted", so the list behind step 1
                // is stale the moment this succeeds.
                void queryClient.invalidateQueries({
                  queryKey: householdLeadsKey(household.id),
                });
                onOpenChange(false);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
