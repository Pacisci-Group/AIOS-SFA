import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { leadDetailKey } from "@/features/lead/components/useUpdateLead";
import { QuoteRecapForm } from "@/features/quote-recap/components/QuoteRecapForm";
import {
  emptyQuoteRecap,
  parseQuoteRecap,
  toPolicyInputs,
  type QuoteRecapFormValues,
} from "@/features/quote-recap/components/quote-recap-schema";
import {
  createQuoteRecapWithDocument,
  getQuoteRecapContext,
} from "@/lib/quote-recaps-api";
import { newSubmissionToken } from "@/lib/submission-token";

interface StartQuoteRecapStepProps {
  leadId: string;
  /** Back to the lead picker. */
  onBack: () => void;
  onDone: () => void;
}

/**
 * Step 2 of the Start Quote dialog: the Quote Recap form itself.
 *
 * The same `QuoteRecapForm` the `/quote-recaps/new` page renders — one form,
 * two entry points, so a change to the policy rules lands on both. What differs
 * is only what happens either side of it: the page navigates to the lead
 * afterwards, this closes the dialog and leaves the producer on the client they
 * were reading.
 */
export function StartQuoteRecapStep({
  leadId,
  onBack,
  onDone,
}: StartQuoteRecapStepProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // See `NewQuoteRecapPage` — a ref, so a retry after a failed submit reuses
  // the token and is idempotent server-side rather than creating a second
  // recap.
  const submissionToken = useRef(newSubmissionToken());

  const contextQuery = useQuery({
    queryKey: ["quote-recap-context", leadId],
    queryFn: () => getQuoteRecapContext(leadId),
  });

  const mutation = useMutation({
    mutationFn: (values: QuoteRecapFormValues) =>
      createQuoteRecapWithDocument({
        leadId,
        policies: toPolicyInputs(values.policies),
        insuranceRenewalMonth: values.insuranceRenewalMonth,
        notes: values.notes?.trim() ? values.notes.trim() : undefined,
        file: values.quoteDocument,
        submissionToken: submissionToken.current,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      // The lead's own cached detail, for the same reason `NewQuoteRecapPage`
      // does it: `staleTime` would otherwise serve the pre-recap view.
      void queryClient.invalidateQueries({ queryKey: leadDetailKey(leadId) });
      toast.success("Quote recap recorded");
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground"
        disabled={mutation.isPending}
        onClick={onBack}
      >
        <ArrowLeft size={14} />
        Back to lead
      </Button>

      {contextQuery.isPending && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading lead…
        </p>
      )}

      {contextQuery.isError && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle size={16} />
            {contextQuery.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void contextQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {/*
        Rendered only once the context resolves, so `defaultValues` are computed
        once from real data — in particular whether the "same as household"
        toggle can safely default on.
      */}
      {contextQuery.data && (
        <QuoteRecapForm
          context={contextQuery.data}
          initialValues={emptyQuoteRecap()}
          submitting={mutation.isPending}
          errorMessage={error}
          onSubmit={(values) => {
            setError(null);
            // Narrows `quoteDocument` from form state's optional to the wire
            // shape's required. Validation has already passed.
            mutation.mutate(parseQuoteRecap(values));
          }}
        />
      )}
    </div>
  );
}
