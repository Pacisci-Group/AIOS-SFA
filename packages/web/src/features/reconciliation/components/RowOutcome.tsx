import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  canRecordReconciliationSale,
  canSetUpReconciliationService,
  MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH,
  ModuleKey,
  RECONCILIATION_SALE_OUTCOME_KINDS,
  reconciliationOutcomeKinds,
  type ReconciliationOutcomeKind,
} from "@sfa/shared";
import { SectionLabel } from "@/components/common/DetailCard";
import { FormError } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/auth-context";
import { useStartReplacement } from "@/features/policy/useStartReplacement";
import { useAppForm } from "@/hooks/form";
import { usePermissions } from "@/hooks/usePermissions";
import {
  reconciliationAssignedRowKey,
  reconciliationKey,
  recordReconciliationOutcome,
  type ReconciliationAssignedRowDetail,
  type ReconciliationOutcome,
  type ReconciliationRowView,
} from "@/lib/carrier-reconciliation-api";
import {
  apiErrorMessage,
  apiErrorStatus,
  formatInstant,
  outcomeBadgeVariant,
  outcomeLabel,
} from "../reconciliation-format";

const SALE_KINDS: readonly ReconciliationOutcomeKind[] =
  RECONCILIATION_SALE_OUTCOME_KINDS;
const isSaleKind = (kind: ReconciliationOutcomeKind) =>
  SALE_KINDS.includes(kind);

/** What the assignee sees on a button, by kind. */
const START_LABELS: Record<ReconciliationOutcomeKind, string> = {
  sold: "Record as sold",
  cancel_rewrite: "Cancel rewrite",
  service_intake: "Set up for service",
  other: "Other…",
};

/**
 * What became of the row (PAC-173 PR 4) — between Assignment and Decision in
 * the shared drawer.
 *
 * **Only the row's assignee records an outcome** (owner, 28 Oct 2026). For
 * them it is the row's actions:
 *
 * - **Sold** — the policy was the agency's sale and never entered: the New
 *   Lead and Sold forms, prefilled from the Dash line, finish it.
 * - **Cancel rewrite** — entered the same way, then its replacement is
 *   written through the ordinary Cancel & rewrite chain, so the trail and the
 *   chargeback exist.
 * - **Set up for service** — a 1-800 policy the app does not have (PR 5): its
 *   own form records the client and the policy, never a sale, and opens a
 *   CSR's welcome call.
 * - **Other** — anything else, in a note. Done at once.
 *
 * Finishing one resolves the row with the outcome's resolution, which is why
 * the owner's Decision section offers Reopen for it rather than its form.
 *
 * Everyone else — the owner included — reads it: what it is, its note, who
 * started and finished it, and links to what it booked. The owner keeps
 * assigning, reassigning and deciding by hand in the sections around it, and
 * each of those stops an outcome under way (their forms say so).
 *
 * What is offered follows the row (`reconciliationOutcomeKinds`) and, for the
 * two sale kinds, whether the viewer can book a sale
 * (`canRecordReconciliationSale`); for a service intake, whether they can
 * create leads (`canSetUpReconciliationService`) — by permission, never role.
 * The API checks both again, and the outcome's own state.
 */
export function RowOutcomeSection({
  row,
  canOpenRecords,
  onRowChanged,
}: {
  row: ReconciliationRowView;
  /** The drawer's answer to "may this viewer open a policy page". */
  canOpenRecords: boolean;
  onRowChanged: (row: ReconciliationRowView) => void;
}) {
  const { user } = useAuth();
  const { outcome, assignment } = row;
  const isAssignee = !!user && assignment?.user.id === user.id;
  // The API takes an outcome only on a row still waiting on a decision.
  const open = row.needsReview && row.review.status === "open";
  const acting = isAssignee && open && outcome?.status !== "done";

  if (!outcome && !acting && !(assignment && open)) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <SectionLabel>Outcome</SectionLabel>
        {outcome && (
          <Badge variant={outcomeBadgeVariant(outcome)} size="sm">
            {outcomeLabel(outcome)}
          </Badge>
        )}
      </div>
      {outcome ? (
        <OutcomeSummary outcome={outcome} canOpenRecords={canOpenRecords} />
      ) : (
        !acting &&
        assignment && (
          <p className="text-sm text-muted-foreground">
            Nothing recorded yet. {assignment.user.name} records what became of
            it from their own page.
          </p>
        )
      )}
      {acting && (
        <OutcomeActions
          row={row}
          outcome={outcome}
          onRowChanged={onRowChanged}
        />
      )}
    </section>
  );
}

/**
 * The outcome read-only: its note, who started and finished it, and links to
 * what it booked — each shown only to a viewer whose page it opens would admit
 * them, as the drawer's other links are.
 */
function OutcomeSummary({
  outcome,
  canOpenRecords,
}: {
  outcome: ReconciliationOutcome;
  canOpenRecords: boolean;
}) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const who = (person: { id: string; name: string } | null) =>
    !person ? "someone" : person.id === user?.id ? "you" : person.name;
  // `/sold/:id/edit` needs `deal_audits:write`, scoped to the producer's own
  // sales for a Producer: the outcome's sale is its starter's. The owner's
  // page opens every sale.
  const canEditSale =
    can(`${ModuleKey.DealAudits}:write`) &&
    (can("carrier_reconciliation:write") ||
      (!!outcome.startedBy && outcome.startedBy.id === user?.id));
  const links = [
    canEditSale && outcome.dealId
      ? { to: `/sold/${outcome.dealId}/edit`, label: "Open the sale" }
      : null,
    canOpenRecords && outcome.householdId
      ? { to: `/clients/${outcome.householdId}`, label: "Open household" }
      : null,
    canOpenRecords && outcome.policyId
      ? { to: `/policies/${outcome.policyId}`, label: "Open policy" }
      : null,
    // The workspace opens a ticket from `?ticket=`; it needs CRM service.
    can(`${ModuleKey.CrmService}:read`) && outcome.ticketId
      ? {
          to: `/crm/tickets?ticket=${outcome.ticketId}`,
          label: "Open the welcome call",
        }
      : null,
    canOpenRecords && outcome.replacementPolicyId
      ? {
          to: `/policies/${outcome.replacementPolicyId}`,
          label: "Open the replacement",
        }
      : null,
  ].filter((link) => link !== null);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Started by{" "}
        <span className="font-medium text-card-foreground">
          {who(outcome.startedBy)}
        </span>{" "}
        on {formatInstant(outcome.startedAt)}
        {outcome.completedAt
          ? ` · finished by ${who(outcome.completedBy)} on ${formatInstant(
              outcome.completedAt,
            )}`
          : ""}
      </p>
      {outcome.note && (
        <p className="border-l-2 border-border pl-3 text-sm whitespace-pre-line">
          {outcome.note}
        </p>
      )}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Put a recorded outcome where the drawer reads it — the row by id, which an
 * assignee's drawer falls back to once a resolved row leaves their list — and
 * refresh everything that counts it.
 */
function applyRecorded(
  queryClient: QueryClient,
  updated: ReconciliationAssignedRowDetail,
  onRowChanged: (row: ReconciliationRowView) => void,
) {
  queryClient.setQueryData(reconciliationAssignedRowKey(updated.id), updated);
  void queryClient.invalidateQueries({ queryKey: reconciliationKey });
  onRowChanged(updated);
}

/**
 * A refused outcome, in the API's words. A 404 (no longer the caller's) or a
 * 409 (decided, replaced, or already booked another way) means the drawer is
 * out of date, so it is refreshed to say where the row stands now.
 */
function reportRefusal(queryClient: QueryClient, error: unknown) {
  toast.error(apiErrorMessage(error, "The outcome could not be recorded."));
  const status = apiErrorStatus(error);
  if (status === 404 || status === 409) {
    void queryClient.invalidateQueries({ queryKey: reconciliationKey });
  }
}

/** The toast for an outcome the request found already finished. */
function doneMessage(outcome: ReconciliationOutcome): string {
  if (outcome.kind === "other") return "Recorded. The row is resolved.";
  if (outcome.kind === "service_intake") {
    return "Set up for service — the welcome call is open, and the row is resolved.";
  }
  return outcome.kind === "cancel_rewrite"
    ? "The replacement was already written — the row is resolved."
    : "The sale was already booked — the row is resolved.";
}

/**
 * The assignee's buttons: start an outcome, or carry one under way to its next
 * form.
 *
 * Every step sends the outcome first, then routes on the row it returns — the
 * same kind again **resumes** it, and the API completes one whose sale or
 * replacement was booked but whose follow-up failed. Without that a booked
 * lead would read "already sold" on the Sold form and strand the row. So:
 *
 * - `record_sale` with its lead → the Sold form for that lead; without → the
 *   New Lead form. Both carry the row.
 * - `write_replacement` → the ordinary Cancel & rewrite chain on the policy
 *   the sale booked (`useStartReplacement`), carrying the row.
 * - `start_onboarding` → the welcome call is opened again; the client and the
 *   policy are already saved.
 * - done → said so, and the drawer shows it.
 *
 * **Set up for service** starts on its own page
 * (`/reconciliation/assigned/:rowId/service-intake`), not with a request here:
 * the form is the outcome's first write.
 *
 * Another kind is offered in place of the one under way only while nothing is
 * booked — the API's rule, mirrored so the buttons never offer a 409.
 */
function OutcomeActions({
  row,
  outcome,
  onRowChanged,
}: {
  row: ReconciliationRowView;
  outcome: ReconciliationOutcome | null;
  onRowChanged: (row: ReconciliationRowView) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { permissions } = usePermissions();
  const [otherOpen, setOtherOpen] = useState(false);

  const allowed = reconciliationOutcomeKinds(row);
  const canSell = canRecordReconciliationSale([...permissions]);
  const canService = canSetUpReconciliationService([...permissions]);
  const kinds = allowed.filter(
    (kind) =>
      (!isSaleKind(kind) || canSell) &&
      (kind !== "service_intake" || canService),
  );
  const saleWithheld = !canSell && allowed.some(isSaleKind);
  const serviceWithheld = !canService && allowed.includes("service_intake");

  const replacement = useStartReplacement(
    outcome?.policyId ?? "",
    "cancel_rewrite",
    { reconciliationRowId: row.id },
  );

  const record = useMutation({
    mutationFn: (kind: ReconciliationOutcomeKind) =>
      recordReconciliationOutcome(row.id, { kind }),
    onSuccess: (updated) => {
      applyRecorded(queryClient, updated, onRowChanged);
      const next = updated.outcome;
      if (!next) return;
      if (next.status === "done") {
        toast.success(doneMessage(next));
        return;
      }
      if (next.step === "start_onboarding") {
        toast.error(
          "The welcome call still could not be opened. The client and the policy are saved — try again in a moment.",
        );
        return;
      }
      if (next.step === "record_sale") {
        const params = new URLSearchParams({ reconciliationRowId: row.id });
        if (next.leadId) params.set("leadId", next.leadId);
        const form = next.leadId ? "/sold/new" : "/leads/new";
        navigate(`${form}?${params.toString()}`);
        return;
      }
      // The hook is bound to the policy this render knew. A sale the request
      // itself just picked up names a policy the drawer has not shown yet:
      // say what is next, and the re-rendered button carries it.
      if (next.policyId && next.policyId === outcome?.policyId) {
        replacement.start();
      } else {
        toast.info("The sale is booked. Write its replacement next.");
      }
    },
    onError: (error) => reportRefusal(queryClient, error),
  });

  const busy = record.isPending || replacement.isStarting;
  const underWay = outcome?.status === "in_progress" ? outcome : null;
  // Another kind is the API's to refuse once anything is booked.
  const switchable = underWay?.step === "record_sale" && !underWay.dealId;
  const alternatives = kinds.filter((kind) => kind !== underWay?.kind);
  // The API refuses a sale kind — resuming included — to someone who can no
  // longer book one: the owner took the permission away, or a work transfer
  // handed the row to someone without it.
  const resumeWithheld =
    !!underWay &&
    ((isSaleKind(underWay.kind) && !canSell) ||
      (underWay.kind === "service_intake" && !canService));

  const kindButton = (kind: ReconciliationOutcomeKind, primary: boolean) => (
    <Button
      key={kind}
      size="sm"
      variant={primary ? "default" : "outline"}
      disabled={busy}
      onClick={() => {
        if (kind === "other") setOtherOpen(true);
        else if (kind === "service_intake") {
          navigate(`/reconciliation/assigned/${row.id}/service-intake`);
        } else record.mutate(kind);
      }}
    >
      {START_LABELS[kind]}
    </Button>
  );

  return (
    <div className="space-y-3">
      {!underWay ? (
        <>
          <p className="text-sm text-muted-foreground">
            {kinds.some(isSaleKind)
              ? "What became of this line? Sold enters it on the New Lead and Sold forms, filled in from Dash. Cancel rewrite enters it the same way, then writes the policy that replaced it. Other is anything else, in a note. Finishing one resolves the row."
              : kinds.includes("service_intake")
                ? "Allstate sold this policy directly. Set up for service records the client and the policy — never a sale — and opens a CSR's welcome call. Other is anything else, in a note. Either one resolves the row."
                : "What became of this line? Record it in a note for the owner — that resolves the row."}
          </p>
          <div className="flex flex-wrap gap-2">
            {kinds.map((kind) =>
              kindButton(kind, kind === "sold" || kind === "service_intake"),
            )}
          </div>
        </>
      ) : resumeWithheld ? (
        <p className="text-sm text-muted-foreground">
          {underWay.kind === "service_intake"
            ? "Opening the welcome call takes permission to add leads, which you don't have. Ask the owner to reassign the row."
            : `Finishing this sale takes permission to add leads and book sales, which you don't have. Ask the owner to reassign the row or reopen it${switchable ? ", or record it as something else below" : ""}.`}
        </p>
      ) : underWay.step === "start_onboarding" ? (
        <>
          <p className="text-sm text-muted-foreground">
            The client and the policy are saved, but the welcome call did not
            open. Try again — it finishes the row.
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => record.mutate(underWay.kind)}
          >
            {busy && <Loader2 aria-hidden className="animate-spin" />}
            Open the welcome call
          </Button>
        </>
      ) : underWay.step === "write_replacement" ? (
        <>
          <p className="text-sm text-muted-foreground">
            The sale is booked. Write the policy that replaced it — the old one
            is retired and its chargeback recorded with it, and that finishes
            the row.
          </p>
          <Button
            size="sm"
            disabled={busy || !underWay.policyId}
            onClick={() => record.mutate(underWay.kind)}
          >
            {busy && <Loader2 aria-hidden className="animate-spin" />}
            Write the replacement
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {underWay.leadId
              ? "The lead is in — the sale is next."
              : "Next: who it was sold to, then the policy."}
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => record.mutate(underWay.kind)}
          >
            {busy ? (
              <Loader2 aria-hidden className="animate-spin" />
            ) : (
              <ArrowRight aria-hidden />
            )}
            Continue
          </Button>
        </>
      )}

      {underWay && switchable && alternatives.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            Was it something else? Nothing is booked yet, so it can still be
            recorded as one of these instead.
          </p>
          <div className="flex flex-wrap gap-2">
            {alternatives.map((kind) => kindButton(kind, false))}
          </div>
        </div>
      )}

      {saleWithheld && !underWay && (
        <p className="text-xs text-muted-foreground">
          Recording it as sold takes permission to add leads and book sales,
          which you don't have. Ask the owner if it was a sale.
        </p>
      )}

      {serviceWithheld && !underWay && (
        <p className="text-xs text-muted-foreground">
          Setting it up for service takes permission to add leads, which you
          don't have. Ask the owner to reassign the row.
        </p>
      )}

      <OtherOutcomeDialog
        rowId={row.id}
        open={otherOpen}
        onOpenChange={setOtherOpen}
        onRowChanged={onRowChanged}
      />
    </div>
  );
}

const otherSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, "Say what became of it")
    .max(
      MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH,
      `At most ${MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH} characters`,
    ),
});

type OtherValues = z.infer<typeof otherSchema>;

const EMPTY_OTHER: OtherValues = { note: "" };

/**
 * Other — anything that is not a sale to enter, in a note the owner reads.
 * Done at once: the row is resolved with it. The note is required, because it
 * is the whole of what an Other says.
 */
function OtherOutcomeDialog({
  rowId,
  open,
  onOpenChange,
  onRowChanged,
}: {
  rowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRowChanged: (row: ReconciliationRowView) => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (values: OtherValues) =>
      recordReconciliationOutcome(rowId, {
        kind: "other",
        note: values.note.trim(),
      }),
    onSuccess: (updated) => {
      applyRecorded(queryClient, updated, onRowChanged);
      toast.success("Recorded. The row is resolved.");
      onOpenChange(false);
    },
    onError: (error) => {
      const status = apiErrorStatus(error);
      if (status === 404 || status === 409) {
        void queryClient.invalidateQueries({ queryKey: reconciliationKey });
      }
    },
  });

  const form = useAppForm({
    defaultValues: EMPTY_OTHER,
    validators: { onSubmit: otherSchema },
    onSubmit: ({ value }) => save.mutate(value),
  });

  // Clear on open, so a cancelled note never resurfaces in the next one.
  // `form` and `save` are stable instances.
  useEffect(() => {
    if (open) {
      form.reset(EMPTY_OTHER);
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What became of it?</DialogTitle>
          <DialogDescription>
            For anything that isn't a sale to enter — already in the app under
            another number, not the agency's, a duplicate. The owner reads
            your note, and the row is resolved.
          </DialogDescription>
        </DialogHeader>

        <form.AppForm>
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.AppField name="note">
              {(f) => (
                <f.TextareaField
                  label="Note"
                  rows={4}
                  placeholder="What happened, and anything the owner should do"
                />
              )}
            </form.AppField>

            <FormError>
              {save.isError
                ? apiErrorMessage(
                    save.error,
                    "The outcome could not be recorded.",
                  )
                : null}
            </FormError>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={save.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && (
                  <Loader2 aria-hidden className="animate-spin" />
                )}
                Record
              </Button>
            </DialogFooter>
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
