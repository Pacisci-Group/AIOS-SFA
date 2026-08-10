import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getPublicLeadForm, submitPublicLead } from "@/lib/lead-intake-api";
import { LeadIntakeForm } from "./components/LeadIntakeForm";
import {
  newSubmissionToken,
  type LeadIntakeFormValues,
} from "./components/lead-intake-schema";

/**
 * `/f/lead/:token` — the public intake form (PAC-37).
 *
 * Deliberately outside the app shell: no sidebar, no nav, no authenticated
 * chrome. Mobile-first, because most people opening a link a producer texted or
 * emailed them will be on a phone.
 *
 * Routed as a sibling of BOTH route guards. `ProtectedRoute` would bounce an
 * anonymous prospect to `/login`, and `PublicOnlyRoute` would redirect a
 * signed-in producer away from previewing their own link.
 */
export default function PublicLeadFormPage() {
  const { token = "" } = useParams();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const submissionToken = useRef(newSubmissionToken());

  const form = useQuery({
    queryKey: ["public-lead-form", token],
    queryFn: () => getPublicLeadForm(token),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (values: LeadIntakeFormValues) =>
      submitPublicLead(token, {
        primaryContact: values.primaryContact,
        address: values.address,
        members: values.members,
        submissionToken: submissionToken.current,
      }),
    onSuccess: () => setSubmitted(true),
    onError: (err: Error) => setError(err.message),
  });

  const agencyName = form.data?.agencyName ?? "";

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-8">
      <div className="mx-auto w-full max-w-lg">
        {form.isPending ? (
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        ) : form.isError ? (
          // The API returns one identical message for an unknown token, a
          // revoked link, a disabled agency and a deactivated producer — so this
          // screen must not speculate about which happened either.
          <div className="rounded-xl bg-card border border-border p-6 text-center space-y-3">
            <ShieldAlert size={24} className="mx-auto text-amber-500" />
            <h1 className="text-sm font-bold">This form isn't available</h1>
            <p className="text-sm text-muted-foreground">
              The link may have expired or been turned off. Please check with the
              person who shared it with you.
            </p>
          </div>
        ) : submitted ? (
          <div className="rounded-xl bg-card border border-border p-6 text-center space-y-3">
            <CheckCircle2 size={24} className="mx-auto text-emerald-500" />
            <h1 className="text-sm font-bold">Thank you — we've got it</h1>
            <p className="text-sm text-muted-foreground">
              {agencyName} has received your information and will be in touch
              shortly.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // A fresh token, or the second submission would dedupe onto the
                // first and silently do nothing.
                submissionToken.current = newSubmissionToken();
                setFormKey((key) => key + 1);
                setError(null);
                setSubmitted(false);
              }}
            >
              Submit another
            </Button>
          </div>
        ) : (
          <>
            <header className="mb-6 text-center">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {agencyName}
              </p>
              <h1 className="mt-1 text-lg font-bold">Tell us about yourself</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Share a few details and someone will reach out with a quote.
              </p>
            </header>

            <LeadIntakeForm
              key={formKey}
              showLeadSource={false}
              submitting={mutation.isPending}
              errorMessage={error}
              submitLabel="Submit"
              onSubmit={(values) => {
                setError(null);
                mutation.mutate(values);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
