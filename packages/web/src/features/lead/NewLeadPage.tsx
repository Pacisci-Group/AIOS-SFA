import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Button } from "@/components/ui/button";
import { createLead } from "@/lib/lead-intake-api";
import { LeadIntakeForm } from "./components/LeadIntakeForm";
import {
  newSubmissionToken,
  type LeadIntakeFormValues,
} from "./components/lead-intake-schema";

/**
 * `/leads/new` — the authenticated New Lead form (PAC-37), and the destination
 * the shared `AddLeadButton` has been pointing at since PAC-17.
 */
export default function NewLeadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Held in a ref, not form state: it must survive a failed submit unchanged,
  // because that is exactly what makes the retry idempotent server-side rather
  // than creating a second lead.
  const submissionToken = useRef(newSubmissionToken());

  const mutation = useMutation({
    mutationFn: (values: LeadIntakeFormValues) =>
      createLead({
        primaryContact: values.primaryContact,
        address: values.address,
        members: values.members,
        // No policies of interest and no property address: this form does not
        // ask (PAC-56 #2 scopes that to the public one), and sending the unasked
        // defaults would record a choice the producer never made.
        leadSourceCode: values.leadSourceCode ?? "",
        submissionToken: submissionToken.current,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      navigate(`/leads/${created.id}`, { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

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
            <Link to="/leads" aria-label="Back to leads">
              <ArrowLeft size={16} />
            </Link>
          </Button>
          <div>
            <h1 className="text-sm font-bold">New lead</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Household intake
            </p>
          </div>
        </header>

        <main className="px-4 md:px-6 py-6">
          <div className="max-w-3xl">
            <LeadIntakeForm
              variant="internal"
              submitting={mutation.isPending}
              errorMessage={error}
              onSubmit={(values) => {
                setError(null);
                mutation.mutate(values);
              }}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
