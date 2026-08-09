import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Button } from "@/components/ui/button";
import { leadDetailKey } from "@/features/lead/components/useUpdateLead";
import {
  getQuoteRecapEditView,
  updateQuoteRecapWithDocument,
} from "@/lib/quote-recaps-api";
import { formatCurrency } from "@/features/lead/components/lead-display";
import { QuoteRecapForm } from "./components/QuoteRecapForm";
import {
  toQuoteRecapFormValues,
  toUpdateQuoteRecapInput,
  type QuoteRecapFormState,
} from "./components/quote-recap-schema";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Exported so the page and anything invalidating it agree on the key. */
export function quoteRecapEditKey(recapId: string) {
  return ["quote-recap-edit", recapId] as const;
}

/**
 * `/quote-recaps/:id/edit` — correct a recorded quote (PAC-56 #11).
 *
 * Reuses `QuoteRecapForm` in `edit` mode rather than forking it, so the policy
 * drawer, the per-policy addresses (#14) and the notes field behave identically
 * on both paths and a future change to any of them lands on both.
 *
 * Legacy had this: the SmartSuite Quote Recaps table carried an `Update URL`
 * formula pointing at Fillout form `cusXRDS52ous`. The rebuild shipped
 * create-only, so a mistyped premium was permanent.
 */
export default function EditQuoteRecapPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const viewQuery = useQuery({
    queryKey: quoteRecapEditKey(id),
    queryFn: () => getQuoteRecapEditView(id),
    enabled: OBJECT_ID.test(id),
  });

  const view = viewQuery.data;
  const leadId = view?.context.leadId ?? "";

  const mutation = useMutation({
    mutationFn: (values: QuoteRecapFormState) =>
      updateQuoteRecapWithDocument(id, {
        leadId,
        ...toUpdateQuoteRecapInput(values),
        // Absent unless the producer picked a replacement — which is what tells
        // the API to keep the document already attached.
        file: values.quoteDocument,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadDetailKey(leadId) });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      // The Quoted scorecard reads the recap totals this edit just changed.
      void queryClient.invalidateQueries({ queryKey: ["performance"] });
      void queryClient.invalidateQueries({ queryKey: quoteRecapEditKey(id) });
      toast.success("Quote recap updated");
      navigate(`/leads/${leadId}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!OBJECT_ID.test(id)) {
    return <Navigate to="/leads" replace />;
  }

  /*
   * A migrated recap carries aggregate totals but no per-policy rows — the
   * import never had them. Saving replaces that aggregate with whatever the
   * producer types, which moves a Quoted-scorecard figure for a past period.
   *
   * Editing is still allowed: blocking it would also block fixing the notes or
   * attaching a document, which is squarely inside what was asked for. But the
   * producer is told, with the current total quoted back at them, so it is a
   * decision rather than a surprise.
   */
  const isMigratedAggregate =
    Boolean(view) && view!.policies.length === 0 && view!.premium > 0;

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
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <Link
              to={leadId ? `/leads/${leadId}` : "/leads"}
              aria-label="Back to lead"
            >
              <ArrowLeft />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Edit quote recap
            </h1>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Correct the recorded proposal
            </p>
          </div>
        </header>

        <main className="px-4 md:px-6 py-6">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {viewQuery.isPending && (
              <div className="flex items-center gap-2 rounded-xl bg-card border border-border p-6 text-base text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
                Loading quote recap…
              </div>
            )}

            {viewQuery.isError && (
              <div className="rounded-xl bg-card border border-border p-6 space-y-3">
                <p className="flex items-center gap-2 text-base text-destructive">
                  <AlertCircle className="size-5" />
                  {viewQuery.error.message}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void viewQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            )}

            {isMigratedAggregate && (
              <p
                role="status"
                className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-base text-card-foreground"
              >
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                <span>
                  This recap was imported and has no per-policy detail. Saving
                  replaces its {formatCurrency(view!.premium)} total with the
                  policies you enter, which will change the Quoted figures for
                  the period it was quoted in.
                </span>
              </p>
            )}

            {/*
             * Rendered only once the recap resolves, so `defaultValues` are
             * computed once from real data — the same reason the create page
             * waits for its context.
             */}
            {view && (
              <QuoteRecapForm
                mode="edit"
                context={view.context}
                initialValues={toQuoteRecapFormValues(view)}
                attachedDocument={view.document}
                submitLabel="Save changes"
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
