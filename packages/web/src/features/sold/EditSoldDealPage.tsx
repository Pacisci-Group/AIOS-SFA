import type {
  CarrierOption,
  SoldDealAddPoliciesBlock,
  SoldDealEditView,
  SoldDealLeadContext,
  SoldStaffOption,
} from "@sfa/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Loader2, Plus, Save } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { SectionLabel } from "@/components/common/DetailCard";
import { FormSection } from "@/components/form";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditPolicyDialog } from "@/features/lead/components/EditPolicyDialog";
import { formatCurrency } from "@/features/lead/components/lead-display";
import { PolicyRow } from "@/features/lead/components/PolicyRow";
import { leadDetailKey } from "@/features/lead/components/useUpdateLead";
import { carriersKey, getCarriers } from "@/lib/carriers-api";
import {
  addSoldDealPolicies,
  getSoldDeal,
  getSoldStaff,
  soldDealKey,
  soldStaffKey,
  updateSoldDeal,
  type UploadScope,
} from "@/lib/sold-deals-api";
import { newSubmissionToken } from "@/lib/submission-token";
import { PolicyDraftStepper } from "./components/PolicyDraftStepper";
import {
  toPolicyInput,
  type SoldPolicyFormValues,
} from "./components/sold-deal-schema";
import { SoldDateCard } from "./components/WizardCards";
import { ownerDashboardKey } from "@/lib/owner-dashboard-api";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Why "Add policy" is not offered, in the producer's terms. */
const BLOCKED_REASONS: Record<SoldDealAddPoliciesBlock, string> = {
  audit_submitted:
    "This sale's audit has already been submitted for review, so no more policies can be added to it.",
  no_lead:
    "This sale isn't linked to a lead, so policies can't be added to it here.",
  no_household:
    "This sale isn't linked to a household, so policies can't be added to it.",
};

/**
 * `/sold/:id/edit` — correct a booked sale (PAC-104).
 *
 * A producer who booked the wrong sold date had no way to fix it: the Sold card
 * edits one policy at a time, and the date lives on the deal. This page edits
 * the sale itself:
 *
 *   - **the sold date**, saved on its own;
 *   - **the policies** — each keeps the Sold card's quick edit, and **Add
 *     policy** runs the same steps as Mark as sold, saving that one policy onto
 *     the deal when it is done.
 *
 * Nothing here removes a policy: a booked sale only grows (decided with the
 * product owner). Each action saves immediately rather than behind one "Save
 * changes", because each is a separate write with its own edit-log row and its
 * own effect on reported figures.
 */
export default function EditSoldDealPage() {
  const { id = "" } = useParams<{ id: string }>();
  const valid = OBJECT_ID.test(id);

  const dealQuery = useQuery({
    queryKey: soldDealKey(id),
    queryFn: () => getSoldDeal(id),
    enabled: valid,
  });

  /** Reference data for Add policy — the same long `staleTime` as Mark as sold. */
  const carriersQuery = useQuery({
    queryKey: carriersKey,
    queryFn: getCarriers,
    staleTime: 30 * 60_000,
  });
  const staffQuery = useQuery({
    queryKey: soldStaffKey,
    queryFn: getSoldStaff,
    staleTime: 30 * 60_000,
  });

  if (!valid) {
    return <Navigate to="/leads" replace />;
  }

  const deal = dealQuery.data;

  return (
    <AppShell>
      <header className="flex items-center gap-2 border-b border-border px-4 py-4 md:gap-3 md:px-6">
        <MobileNav className="-ml-1" />
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Link
            to={deal?.leadId ? `/leads/${deal.leadId}` : "/leads"}
            aria-label="Back to lead"
          >
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Edit sale</h1>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Correct the booked sale
          </p>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {(dealQuery.isPending || carriersQuery.isPending) && (
            <div className="flex items-center gap-2 rounded-xl bg-card border border-border p-6 text-base text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              Loading sale…
            </div>
          )}

          {dealQuery.isError && (
            <LoadError
              message={dealQuery.error.message}
              onRetry={() => void dealQuery.refetch()}
            />
          )}

          {/*
           * Blocks rather than falling through, as on Mark as sold: without the
           * catalog, Add policy has no carrier list and no policy-number rules.
           */}
          {carriersQuery.isError && (
            <LoadError
              message={`Couldn't load the carrier list. ${carriersQuery.error.message}`}
              onRetry={() => void carriersQuery.refetch()}
            />
          )}

          {deal && carriersQuery.data && (
            <>
              <SaleDetailsSection deal={deal} />
              <PoliciesSection
                deal={deal}
                carriers={carriersQuery.data}
                staff={staffQuery.data ?? []}
              />
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-6 space-y-3">
      <p className="flex items-center gap-2 text-base text-destructive">
        <AlertCircle className="size-5" />
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/**
 * Put a saved deal in the cache and refresh everything that shows it.
 *
 * The Sold scorecard and the leaderboard bucket on the sold date and sum the
 * premium, and both change on this page, so they are refreshed on every save —
 * a producer should not see two numbers for the same sale on two pages.
 */
function useApplySavedDeal() {
  const queryClient = useQueryClient();

  return (deal: SoldDealEditView, options: { audits?: boolean } = {}) => {
    queryClient.setQueryData(soldDealKey(deal.id), deal);
    if (deal.leadId) {
      void queryClient.invalidateQueries({
        queryKey: leadDetailKey(deal.leadId),
      });
    }
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["performance"] });
    // The Owner dashboard sums the same sales and quotes (PAC-135).
    void queryClient.invalidateQueries({ queryKey: ownerDashboardKey });
    void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    if (options.audits) {
      void queryClient.invalidateQueries({ queryKey: ["deal-audits"] });
    }
  };
}

/** Who the sale is for, and its sold date. */
function SaleDetailsSection({ deal }: { deal: SoldDealEditView }) {
  const [soldDate, setSoldDate] = useState(deal.soldDate ?? "");
  const applySaved = useApplySavedDeal();

  const mutation = useMutation({
    mutationFn: (value: string) => updateSoldDeal(deal.id, { soldDate: value }),
    onSuccess: (saved) => {
      applySaved(saved);
      setSoldDate(saved.soldDate ?? "");
      toast.success("Sold date updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Couldn't update the sold date");
    },
  });

  const changed = soldDate !== (deal.soldDate ?? "");

  return (
    <FormSection>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Sale for <span className="text-foreground">{deal.clientName}</span>
          {deal.householdName && <> · {deal.householdName}</>}
          {deal.producerName && <> · sold by {deal.producerName}</>}
        </p>
        <span className="flex items-center gap-2">
          {deal.isBundle && (
            <Badge
              size="sm"
              className="bg-emerald-500/12 font-semibold text-emerald-700 dark:text-emerald-500"
            >
              Bundle
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">{deal.dealType}</span>
        </span>
      </div>

      <SoldDateCard
        value={soldDate}
        onChange={setSoldDate}
        disabled={mutation.isPending}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Changing the date moves this sale into that period's Sold figures.
        </p>
        <Button
          type="button"
          size="sm"
          disabled={!changed || !soldDate || mutation.isPending}
          onClick={() => mutation.mutate(soldDate)}
        >
          {mutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Save sold date
        </Button>
      </div>
    </FormSection>
  );
}

/** Every policy on the sale, each editable, and Add policy. */
function PoliciesSection({
  deal,
  carriers,
  staff,
}: {
  deal: SoldDealEditView;
  carriers: CarrierOption[];
  staff: SoldStaffOption[];
}) {
  const applySaved = useApplySavedDeal();
  /** The open Add policy steps, keyed so each opening is a fresh form. */
  const [draftKey, setDraftKey] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * One token per policy being added. A retry of *this* policy must replay
   * server-side rather than add it twice; the next policy must not replay.
   */
  const submissionToken = useRef(newSubmissionToken());

  const mutation = useMutation({
    mutationFn: (values: SoldPolicyFormValues) =>
      addSoldDealPolicies(deal.id, {
        policies: [toPolicyInput(values)],
        submissionToken: submissionToken.current,
      }),
    onSuccess: (result) => {
      applySaved(result.deal, { audits: true });
      setDraftKey(null);
      setError(null);
      toast.success(
        result.replayed
          ? "That policy was already on the sale"
          : "Policy added to the sale",
      );
    },
    onError: (err: Error) => setError(err.message),
  });

  const startAdding = () => {
    submissionToken.current = newSubmissionToken();
    setError(null);
    setDraftKey(Date.now());
  };

  /*
   * The steps take the Mark as sold form's lead-shaped context. Only the client
   * name and the contacts behind the defensive-driver picker are read.
   *
   * `replacementReason` is null: adding a policy to a booked sale replaces
   * nothing, so the steps run the plain `sale` variant (PAC-126).
   */
  const context: SoldDealLeadContext = useMemo(
    () => ({
      leadId: deal.leadId ?? "",
      primaryContactName: deal.clientName,
      householdId: deal.householdId,
      householdName: deal.householdName,
      contacts: deal.contacts,
      leadStatus: "Sold",
      hasQuoteRecap: true,
      replacementReason: null,
    }),
    [deal],
  );

  // Keyed on the deal's lead — where the Sold form's uploads are anchored, and
  // what the server checks the keys against.
  const uploadScope: UploadScope = useMemo(
    () => ({ kind: "lead", leadId: deal.leadId ?? "" }),
    [deal.leadId],
  );

  return (
    <>
      <FormSection
        title="Policies on this sale"
        action={
          deal.canAddPolicies && draftKey === null ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startAdding}
            >
              <Plus size={14} />
              Add policy
            </Button>
          ) : undefined
        }
      >
        {deal.policies.length > 0 ? (
          <ul className="divide-y divide-border">
            {deal.policies.map((policy) => (
              <li
                key={policy.id}
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <PolicyRow policy={policy} />
                </div>
                <EditPolicyDialog leadId={deal.leadId ?? ""} policy={policy} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-muted-foreground">
            {deal.policyTypes.join(", ") ||
              "No policy detail linked to this sale."}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <SectionLabel>
            Total · {deal.itemCount} item{deal.itemCount === 1 ? "" : "s"} ·{" "}
            {deal.policyCount}{" "}
            {deal.policyCount === 1 ? "policy" : "policies"}
          </SectionLabel>
          <span className="text-lg font-semibold tabular-nums text-card-foreground">
            {formatCurrency(deal.premium)}
          </span>
        </div>

        {deal.addPoliciesBlockedBy && (
          <p role="status" className="text-sm text-muted-foreground">
            {BLOCKED_REASONS[deal.addPoliciesBlockedBy]}
          </p>
        )}
      </FormSection>

      {/*
       * A migrated deal's total is SmartSuite's rollup, which may count policies
       * this database never received. Adding one recomputes it from the rows
       * listed above (the product owner's call) — so the producer is told, with
       * the current total quoted back, before it happens.
       */}
      {draftKey !== null && deal.isMigrated && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-base text-card-foreground"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <span>
            This sale was imported from SmartSuite. Adding a policy recalculates
            its {formatCurrency(deal.premium)} total from the policies listed
            above, which can change past Sold figures.
          </span>
        </p>
      )}

      {draftKey !== null && (
        <PolicyDraftStepper
          key={draftKey}
          variant="sale"
          context={context}
          carriers={carriers}
          staff={staff}
          uploadScope={uploadScope}
          position={deal.policies.length + 1}
          commitLabel="Add to sale"
          busy={mutation.isPending}
          errorMessage={error}
          onCommit={(values) => {
            setError(null);
            mutation.mutate(values);
          }}
          onCancel={() => {
            setDraftKey(null);
            setError(null);
          }}
        />
      )}
    </>
  );
}
