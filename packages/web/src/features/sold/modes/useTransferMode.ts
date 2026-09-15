import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getServiceTicket,
  recordPolicyTransfer,
} from "@/lib/service-tickets-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { toPolicyInput } from "../components/sold-deal-schema";
import {
  carrierError,
  OBJECT_ID,
  useCarrierCatalog,
  type FlowBlock,
  type SoldFlow,
} from "./sold-flow";

interface TransferModeArgs {
  ticketId: string;
  enabled: boolean;
}

/**
 * `/policy-transfers/new?ticketId={id}` — the CSR's package-change form.
 *
 * Ticket-scoped rather than lead-scoped: a transfer has no lead. The household
 * is resolved from the ticket server-side, which is what stops a CSR recording a
 * transfer against a book they cannot see.
 *
 * **It keeps its own route**, unlike the rewrite, because the route's permission
 * gate differs: `POST /crm/service-tickets/:id/policy-transfer` requires
 * `crm_service:write`, and a CSR holds no `deal_audits` permission at all — so
 * serving this from `/sold/new`, which is gated on `deal_audits:write`, would
 * lock out exactly the person the flow is for. Same page, same wizard, different
 * gate.
 */
export function useTransferMode({
  ticketId,
  enabled,
}: TransferModeArgs): SoldFlow {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // In a ref, not state: a retry after a failed submit must reuse the same
  // token, which is what makes the retry idempotent server-side rather than
  // booking a second transfer.
  const submissionToken = useRef(newSubmissionToken());

  const usable = enabled && OBJECT_ID.test(ticketId);

  const ticketQuery = useQuery({
    queryKey: ["service-ticket", ticketId],
    queryFn: () => getServiceTicket(ticketId),
    enabled: usable,
  });

  const carriersQuery = useCarrierCatalog();
  const ticket = ticketQuery.data;

  const mutation = useMutation({
    mutationFn: (values: Parameters<SoldFlow["onSubmit"]>[0]) =>
      recordPolicyTransfer(ticketId, {
        transferDate: values.soldDate,
        policies: values.policies.map(toPolicyInput),
        submissionToken: submissionToken.current,
      }),
    onSuccess: (updated) => {
      // The transfer moves the household's policy list, the CSR queue, and the
      // scorecards at once.
      void queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
      void queryClient.invalidateQueries({ queryKey: ["household"] });
      void queryClient.invalidateQueries({ queryKey: ["performance"] });
      void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });
      toast.success(
        `Transfer recorded — ${updated.policyTransfer?.policyCount ?? 0} ${
          updated.policyTransfer?.policyCount === 1 ? "policy" : "policies"
        }`,
      );
      navigate(`/crm/tickets?ticket=${ticketId}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  /*
   * The three server-side rejections, mirrored so a typed URL cannot walk into a
   * wizard that will 400 on submit.
   */
  let blocked: FlowBlock | null = null;
  if (ticket && !ticket.allowsPolicyTransfer) {
    blocked = {
      title: `A ${ticket.category} ticket cannot record a policy transfer.`,
      detail:
        "Transfers are recorded from Renewal Review, Policy Change, Payment or Company Transfer tickets.",
    };
  } else if (ticket?.allowsPolicyTransfer && !ticket.householdId) {
    blocked = {
      title: "This ticket is not linked to a household yet.",
      detail:
        "A transfer moves a client within their own book, so the ticket needs a household first.",
    };
  } else if (ticket?.allowsPolicyTransfer && ticket.policyTransfer) {
    blocked = {
      title: "A transfer has already been recorded on this ticket.",
      detail: "One transfer per ticket. Open a new ticket to record another.",
    };
  }

  return {
    variant: "transfer",
    title: "Policy transfer",
    subtitle: "Record a package change — not new business",
    backTo: `/crm/tickets?ticket=${ticketId}`,
    backLabel: "Back to ticket",
    redirect: OBJECT_ID.test(ticketId) ? null : "/crm/tickets",
    loading:
      ticketQuery.isPending || carriersQuery.isPending ? "Loading ticket…" : null,
    errors: [
      ...(ticketQuery.isError
        ? [
            {
              title: "Couldn't load this ticket.",
              detail: ticketQuery.error.message,
              retry: () => void ticketQuery.refetch(),
            },
          ]
        : []),
      ...carrierError(carriersQuery),
    ],
    blocked,
    ready:
      !blocked &&
      ticket?.allowsPolicyTransfer &&
      ticket.householdId &&
      carriersQuery.data
        ? {
            context: {
              /*
               * The wizard's context is lead-shaped because the sale path built
               * it. A transfer has no lead, so only the fields the transfer
               * variant actually reads are meaningful: the client name in the
               * header, and the contacts behind the defensive driver picker —
               * which a transfer has none of, hence the empty list.
               */
              leadId: "",
              primaryContactName: ticket.clientName,
              householdId: ticket.householdId,
              householdName: ticket.household || null,
              contacts: [],
              leadStatus: "",
              hasQuoteRecap: false,
            },
            carriers: carriersQuery.data,
            staff: [],
            householdId: ticket.householdId,
            uploadScope: { kind: "ticket", ticketId },
          }
        : null,
    submitting: mutation.isPending,
    errorMessage: error,
    onSubmit: (values) => {
      setError(null);
      mutation.mutate(values);
    },
  };
}
