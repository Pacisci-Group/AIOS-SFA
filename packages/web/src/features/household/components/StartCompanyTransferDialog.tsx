import type { PolicySummary, ServiceTicketView } from "@sfa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createServiceTicket,
  listServiceTicketsForHousehold,
} from "@/lib/service-tickets-api";

interface StartCompanyTransferDialogProps {
  householdId: string;
  policy: PolicySummary;
  /** The caller's `crm_service:write` gate, already evaluated. */
  canTransfer: boolean;
}

/**
 * Start a Company Transfer from a household policy (PAC-126).
 *
 * David: there was no way to record a company transfer from a client. The flow
 * itself has existed since PAC-63, but only from inside a CRM ticket — a service
 * rep looking at a household had to know to go to the ticket queue, find or open
 * the right ticket, and record the transfer from there. Most never did.
 *
 * ## The ticket requirement stays
 *
 * A transfer is still recorded **on a ticket**, and this dialog does not work
 * around that — it is the shortest honest path to one. The ticket is where the
 * conversation, the timeline and the CSR's queue position live, and
 * `POST /crm/service-tickets/:id/policy-transfer` is the only endpoint that
 * books one; a transfer with no ticket would be a deal nobody can explain later.
 *
 * So: reuse a ticket that is already open for this client and can take a
 * transfer, or open a `Company Transfer` one for them and go straight to the
 * form. Either way the next screen is the existing transfer flow, unchanged.
 *
 * ## Why reuse is offered first
 *
 * One transfer per ticket, enforced by a unique index on the deal. A rep who
 * opens a second ticket for a call they are already handling splits one
 * conversation across two records — and the existing ticket is usually the one
 * the client rang about. Candidates are narrowed to exactly the tickets the
 * server would accept: a transfer-capable category, still open, and no transfer
 * recorded yet.
 */
export function StartCompanyTransferDialog({
  householdId,
  policy,
  canTransfer,
}: StartCompanyTransferDialogProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const ticketsQuery = useQuery({
    queryKey: ["service-tickets", "household", householdId],
    queryFn: () => listServiceTicketsForHousehold(householdId),
    // Only on open: a household page renders one of these per policy card, and
    // fetching the same list six times before anyone clicks is pure waste.
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createServiceTicket({
        category: "Company Transfer",
        householdId,
        // The policy that prompted it. The wizard still asks which policy each
        // replacement replaces — it can split one into two — so this records
        // what the call was about rather than pre-deciding the line-up.
        policyId: policy.id,
        openingNote: policy.policyNumber
          ? `Company transfer started from policy ${policy.policyNumber}.`
          : "Company transfer started from the household's policy portfolio.",
      }),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
      toast.success(`Ticket ${ticket.ticketNumber} opened`);
      setOpen(false);
      navigate(`/policy-transfers/new?ticketId=${ticket.id}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!canTransfer) return null;

  const candidates = (ticketsQuery.data ?? []).filter(isTransferable);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Company transfer for ${policy.policyNumber ?? policy.policyType ?? "policy"}`}
        >
          <ArrowRightLeft aria-hidden className="size-4" />
          Company transfer
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Company transfer</DialogTitle>
          <DialogDescription>
            A transfer is recorded on a service ticket. Continue on one that is
            already open for this client, or open a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {ticketsQuery.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Looking for open tickets…
            </p>
          )}

          {ticketsQuery.isError && (
            /*
             * A failed lookup does not block: opening a new ticket is always
             * valid, and the only thing lost is the chance to reuse one. Saying
             * so is better than an empty list that implies there are none.
             */
            <p className="text-sm text-destructive">
              Couldn't check this client's open tickets ({" "}
              {ticketsQuery.error.message} ). You can still open a new one.
            </p>
          )}

          {ticketsQuery.isSuccess && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No open ticket for this client can take a transfer.
            </p>
          )}

          {candidates.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() =>
                navigate(`/policy-transfers/new?ticketId=${ticket.id}`)
              }
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/50"
            >
              <Ticket aria-hidden className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-card-foreground">
                  {ticket.ticketNumber}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {ticket.category} · open {ticket.daysOpen}{" "}
                  {ticket.daysOpen === 1 ? "day" : "days"}
                </span>
              </span>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Plus aria-hidden className="size-4" />
            )}
            Open a new ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Tickets the transfer endpoint would actually accept.
 *
 * `allowsPolicyTransfer` is server-computed from the ticket's category, so this
 * does not re-derive `POLICY_TRANSFER_CATEGORIES` here. The other two conditions
 * are the ones that would 400 on submit: one transfer per ticket, and a resolved
 * or closed ticket is not somewhere to record new work.
 */
function isTransferable(ticket: ServiceTicketView): boolean {
  if (!ticket.allowsPolicyTransfer) return false;
  if (ticket.policyTransfer) return false;
  if (ticket.isArchived) return false;
  return ticket.status !== "resolved" && ticket.status !== "closed";
}
