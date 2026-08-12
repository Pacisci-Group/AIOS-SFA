import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { carriersKey, getCarriers } from "@/lib/carriers-api";
import { getServiceTicket, recordPolicyTransfer } from "@/lib/service-tickets-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { SoldDealWizard } from "./components/SoldDealWizard";
import {
  toPolicyInput,
  type SoldDealFormValues,
} from "./components/sold-deal-schema";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * `/policy-transfers/new?ticketId={id}` — the CSR's package-change form.
 *
 * The **same wizard** as `/sold/new`, in its transfer variant: a policy needs
 * the same information to exist however it came about, so the cards, the
 * validation and the documents are identical. Two differences, both in the
 * variant: it asks which policy each new one replaces, and it never asks for
 * prior insurance.
 *
 * Ticket-scoped rather than lead-scoped — a transfer has no lead. The household
 * is resolved from the ticket server-side, which is what stops a CSR recording
 * a transfer against a book they cannot see.
 */
export default function PolicyTransferPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const ticketId = searchParams.get("ticketId") ?? "";

  // In a ref, not state: a retry after a failed submit must reuse the same
  // token, which is what makes the retry idempotent server-side rather than
  // booking a second transfer.
  const submissionToken = useRef(newSubmissionToken());

  const ticketQuery = useQuery({
    queryKey: ["service-ticket", ticketId],
    queryFn: () => getServiceTicket(ticketId),
    enabled: OBJECT_ID.test(ticketId),
  });

  const carriersQuery = useQuery({
    queryKey: carriersKey,
    queryFn: getCarriers,
    staleTime: 30 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (values: SoldDealFormValues) =>
      recordPolicyTransfer(ticketId, {
        transferDate: values.soldDate,
        policies: values.policies.map(toPolicyInput),
        submissionToken: submissionToken.current,
      }),
    onSuccess: (ticket) => {
      // The transfer moves the household's policy list, the CSR queue, and the
      // scorecards at once.
      void queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["household"] });
      void queryClient.invalidateQueries({ queryKey: ["performance"] });
      void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });
      toast.success(
        `Transfer recorded — ${ticket.policyTransfer?.policyCount ?? 0} ${
          ticket.policyTransfer?.policyCount === 1 ? "policy" : "policies"
        }`,
      );
      navigate(`/crm/tickets?ticket=${ticketId}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!OBJECT_ID.test(ticketId)) {
    return <Navigate to="/crm/tickets" replace />;
  }

  const ticket = ticketQuery.data;
  const backTo = `/crm/tickets?ticket=${ticketId}`;

  return (
    <AppShell>
      <header className="flex items-center gap-2 border-b border-border px-4 py-4 md:gap-3 md:px-6">
        <MobileNav className="-ml-1" />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-foreground"
        >
          <Link to={backTo} aria-label="Back to ticket">
            <ArrowLeft size={16} />
          </Link>
        </Button>
        <div>
          <h1 className="text-sm font-bold">Policy transfer</h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Record a package change — not new business
          </p>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {(ticketQuery.isPending || carriersQuery.isPending) && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Loading ticket…
            </div>
          )}

          {ticketQuery.isError && (
            <TransferBlocked
              title="Couldn't load this ticket."
              detail={ticketQuery.error.message}
              backTo={backTo}
            />
          )}

          {/*
            A failed carrier fetch **blocks**, exactly as on the Sold form:
            falling through to free text would mean one network blip silently
            removes the carrier vocabulary and its policy-number rules.
          */}
          {carriersQuery.isError && (
            <TransferBlocked
              title="Couldn't load the carrier list."
              detail={carriersQuery.error.message}
              backTo={backTo}
            />
          )}

          {/*
            The three server-side rejections, mirrored so a typed URL cannot
            walk into a wizard that will 400 on submit.
          */}
          {ticket && !ticket.allowsPolicyTransfer && (
            <TransferBlocked
              title={`A ${ticket.category} ticket cannot record a policy transfer.`}
              detail="Transfers are recorded from Renewal Review, Policy Change, Payment or Company Transfer tickets."
              backTo={backTo}
            />
          )}

          {ticket?.allowsPolicyTransfer && !ticket.householdId && (
            <TransferBlocked
              title="This ticket is not linked to a household yet."
              detail="A transfer moves a client within their own book, so the ticket needs a household first."
              backTo={backTo}
            />
          )}

          {ticket?.allowsPolicyTransfer && ticket.policyTransfer && (
            <TransferBlocked
              title="A transfer has already been recorded on this ticket."
              detail="One transfer per ticket. Open a new ticket to record another."
              backTo={backTo}
            />
          )}

          {ticket?.allowsPolicyTransfer &&
            ticket.householdId &&
            !ticket.policyTransfer &&
            carriersQuery.data && (
              <SoldDealWizard
                variant="transfer"
                ticketId={ticketId}
                householdId={ticket.householdId}
                /*
                 * The wizard's context is lead-shaped because the sale path
                 * built it. A transfer has no lead, so only the fields the
                 * transfer variant actually reads are meaningful: the client
                 * name in the header, and the contacts behind the defensive
                 * driver picker — which a transfer has none of, hence the
                 * empty list.
                 */
                context={{
                  leadId: "",
                  primaryContactName: ticket.clientName,
                  householdId: ticket.householdId,
                  householdName: ticket.household || null,
                  contacts: [],
                  leadStatus: "",
                  hasQuoteRecap: false,
                }}
                carriers={carriersQuery.data}
                submitting={mutation.isPending}
                errorMessage={error}
                onSubmit={(values) => {
                  setError(null);
                  mutation.mutate(values);
                }}
              />
            )}
        </div>
      </main>
    </AppShell>
  );
}

function TransferBlocked({
  title,
  detail,
  backTo,
}: {
  title: string;
  detail: string;
  backTo: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-6">
      <p className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle size={16} />
        {title}
      </p>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <Button asChild variant="outline" size="sm">
        <Link to={backTo}>Back to the ticket</Link>
      </Button>
    </div>
  );
}
