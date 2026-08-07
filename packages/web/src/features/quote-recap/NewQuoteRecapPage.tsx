import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Button } from "@/components/ui/button";
import {
  createQuoteRecapWithDocument,
  getQuoteRecapContext,
} from "@/lib/quote-recaps-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { QuoteRecapForm } from "./components/QuoteRecapForm";
import {
  toPolicyInputs,
  type QuoteRecapFormValues,
} from "./components/quote-recap-schema";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * `/quote-recaps/new?leadId={id}` — the Quote Recap form (PAC-39).
 *
 * Lead-scoped rather than household-scoped: legacy requires a lead and the API
 * resolves the household from it, so a recap is always reachable from the page
 * a producer actually works in. PAC-38 will point the Lead Detail header button
 * at this same route.
 */
export default function NewQuoteRecapPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const leadId = searchParams.get("leadId") ?? "";

  // Held in a ref so a retry after a failed submit reuses the same token —
  // that is what makes the retry idempotent server-side rather than creating a
  // second recap.
  const submissionToken = useRef(newSubmissionToken());

  const contextQuery = useQuery({
    queryKey: ["quote-recap-context", leadId],
    queryFn: () => getQuoteRecapContext(leadId),
    enabled: OBJECT_ID.test(leadId),
  });

  const mutation = useMutation({
    mutationFn: (values: QuoteRecapFormValues) =>
      createQuoteRecapWithDocument({
        leadId,
        // Each row carries its own property address (PAC-56 #14).
        policies: toPolicyInputs(values.policies),
        notes: values.notes?.trim() ? values.notes.trim() : undefined,
        file: values.quoteDocument,
        submissionToken: submissionToken.current,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Quote recap recorded");
      // Back to the lead, in context. Deliberately NOT deep-linked to the Sold
      // form: those steps are days apart in reality.
      navigate(`/leads/${leadId}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  // Nothing usable to work with — no point rendering an empty form.
  if (!OBJECT_ID.test(leadId)) {
    return <Navigate to="/leads" replace />;
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-3 px-4 md:px-6 py-4 border-b border-border">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
          >
            <Link to={`/leads/${leadId}`} aria-label="Back to lead">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <h1 className="text-sm font-bold">Quote recap</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Record the proposal
            </p>
          </div>
        </header>

        <main className="px-4 md:px-6 py-6">
          <div className="max-w-3xl">
            {contextQuery.isPending && (
              <div className="flex items-center gap-2 rounded-xl bg-card border border-border p-6 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                Loading lead…
              </div>
            )}

            {contextQuery.isError && (
              <div className="rounded-xl bg-card border border-border p-6 space-y-3">
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle size={16} />
                  {contextQuery.error.message}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void contextQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            )}

            {/*
             * Rendered only once the context resolves, so `defaultValues` are
             * computed once from real data — in particular whether the
             * "same as household" toggle can safely default on.
             */}
            {contextQuery.data && (
              <QuoteRecapForm
                context={contextQuery.data}
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
      </div>
    </div>
  );
}
