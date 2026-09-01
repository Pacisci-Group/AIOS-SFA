import type { HouseholdView } from "@sfa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { LeadIntakeForm } from "@/features/lead/components/LeadIntakeForm";
import {
  statusBadgeClass,
  temperatureDot,
} from "@/features/lead/components/lead-display";
import type { LeadIntakeFormValues } from "@/features/lead/components/lead-intake-schema";
import { createLead } from "@/lib/lead-intake-api";
import { formatPhone, listLeads, type LeadRow } from "@/lib/leads-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { cn } from "@/lib/utils";
import { leadIntakeFromHousehold } from "./start-quote-prefill";

/** Query key for this household's leads, shared with the invalidation below. */
export function householdLeadsKey(householdId: string) {
  return ["leads", "household", householdId] as const;
}

interface StartQuoteLeadStepProps {
  household: HouseholdView;
  /** Hand the chosen — or freshly created — lead to step 2. */
  onLeadChosen: (leadId: string) => void;
  onCancel: () => void;
}

/**
 * Step 1 of the Start Quote dialog: **which lead is this quote for?**
 *
 * The step exists because a quote recap hangs off a *lead*, not off a household
 * or a ticket — a household can be quoted several times (a cross-sell, a
 * re-quote at renewal), and each of those is its own lead with its own
 * pipeline. Skipping straight to the recap form would have to invent that
 * answer.
 *
 * Existing leads come first and creating one is the fallback, deliberately: a
 * producer who has been working a lead all week and starts the quote from the
 * client page should land on the lead they already have, not open a second one
 * beside it.
 *
 * A note on what is **not** shown here: a producer whose data scope is `own`
 * sees only their own leads for this household, so a colleague's open lead on
 * the same client is absent rather than listed-but-forbidden. That is the same
 * clamp the Leads page applies and is not special to this dialog.
 */
export function StartQuoteLeadStep({
  household,
  onLeadChosen,
  onCancel,
}: StartQuoteLeadStepProps) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The idempotency key for "create lead", held in a ref so a retry after a
   * failed submit reuses it — that is what makes the retry create one lead
   * rather than two. Same reasoning as `NewLeadPage`.
   *
   * Unlike that page it is **re-minted whenever the create form is opened**
   * (see `openCreateForm`), not once per mount. The page unmounts on success;
   * this dialog does not — a producer can create a lead, step back, and create
   * a second one without the component ever going away. Keeping the first
   * token would make that second submission a replay, and the server would
   * hand back the first lead with no error and no second record.
   */
  const submissionToken = useRef(newSubmissionToken());

  const openCreateForm = () => {
    submissionToken.current = newSubmissionToken();
    setError(null);
    setCreating(true);
  };

  const leadsQuery = useQuery({
    queryKey: householdLeadsKey(household.id),
    queryFn: () =>
      listLeads({ householdId: household.id, pageSize: 100 }),
  });

  const prefill = useMemo(
    () => leadIntakeFromHousehold(household),
    [household],
  );

  const createMutation = useMutation({
    mutationFn: (values: LeadIntakeFormValues) =>
      createLead({
        primaryContact: values.primaryContact,
        address: values.address,
        members: values.members,
        // No policies of interest: the internal form does not ask (PAC-56 #2
        // scopes that to the public one), and sending the unasked defaults
        // would record a choice the producer never made. Same as `NewLeadPage`
        // — and here the very next step asks what was quoted, with premiums.
        leadSourceCode: values.leadSourceCode ?? "",
        submissionToken: submissionToken.current,
        // The whole point of creating from here: the lead lands on the
        // household on screen, whatever the typed name would otherwise match.
        householdId: household.id,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      onLeadChosen(created.id);
    },
    onError: (err: Error) => setError(err.message),
  });

  if (creating) {
    return (
      <div className="space-y-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground"
          disabled={createMutation.isPending}
          onClick={() => {
            setError(null);
            setCreating(false);
          }}
        >
          <ArrowLeft size={14} />
          Choose an existing lead instead
        </Button>

        <p className="text-xs text-muted-foreground">
          Prefilled from {household.name ?? "this household"}. The lead is
          attached to this household whatever you change here — only the lead
          source has to be answered fresh.
        </p>

        <LeadIntakeForm
          variant="internal"
          initialValues={prefill}
          submitting={createMutation.isPending}
          errorMessage={error}
          submitLabel="Create lead & continue"
          onSubmit={(values) => {
            setError(null);
            createMutation.mutate(values);
          }}
        />
      </div>
    );
  }

  const leads = leadsQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      {leadsQuery.isPending && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading this household's leads…
        </p>
      )}

      {leadsQuery.isError && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle size={16} />
            {leadsQuery.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void leadsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {leadsQuery.isSuccess && leads.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No leads on this household yet. Create one to record the quote
          against.
        </p>
      )}

      {leads.length > 0 && (
        <RadioGroup
          value={selectedId ?? ""}
          onValueChange={setSelectedId}
          className="gap-2"
          aria-label="Existing leads for this household"
        >
          {leads.map((lead) => (
            <LeadOption
              key={lead.id}
              lead={lead}
              selected={lead.id === selectedId}
            />
          ))}
        </RadioGroup>
      )}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={openCreateForm}
      >
        <Plus size={14} />
        Create a new lead
      </Button>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="brand"
          disabled={!selectedId}
          onClick={() => selectedId && onLeadChosen(selectedId)}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

/**
 * One selectable lead. The whole row is the label, so the click target is the
 * row rather than the 16px radio beside it.
 */
function LeadOption({ lead, selected }: { lead: LeadRow; selected: boolean }) {
  const contact = [formatPhone(lead.phone), lead.email]
    .filter((part) => part && part !== "—")
    .join(" · ");

  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-accent",
      )}
    >
      <RadioGroupItem value={lead.id} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              temperatureDot[lead.temperature],
            )}
            aria-hidden
          />
          <span className="truncate text-sm font-medium text-foreground">
            {lead.name}
          </span>
          <Badge
            size="sm"
            variant="ghost"
            className={cn("shrink-0", statusBadgeClass(lead.status))}
          >
            {lead.status}
          </Badge>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {[lead.leadSource, contact].filter(Boolean).join(" · ") ||
            "No contact details on file"}
        </span>
      </span>
    </label>
  );
}
