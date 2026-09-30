import type { UploadScope } from "@/lib/sold-deals-api";
import type {
  CarrierOption,
  SoldDealLeadContext,
  SoldStaffOption,
} from "@sfa/shared";
import { Loader2, Plus, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FormError, FormSection } from "@/components/form";
import { Button } from "@/components/ui/button";
import { localTodayYmd } from "@/lib/dates";
import { BlockedReasons } from "./BlockedReasons";
import { PolicyDraftStepper } from "./PolicyDraftStepper";
import { PolicyReviewList } from "./PolicyReviewList";
import { PolicySummaryList } from "./PolicySummaryList";
import type {
  CardIssue,
  SoldDealFormValues,
  SoldPolicyFormValues,
  WizardVariant,
} from "./sold-deal-schema";
import { SoldDateCard } from "./WizardCards";

interface SoldDealWizardProps {
  context: SoldDealLeadContext;
  /** The carrier catalog. The page waits for it, so it is never mid-flight here. */
  carriers: CarrierOption[];
  /**
   * Agency staff for the "Cancelled by" picker (PAC-65 #11).
   *
   * Optional because `cardsFor` drops the prior-insurance card on the
   * replacement variant entirely — it replaces a policy already in our own
   * book, so there is no prior carrier to cancel and no picker to fill.
   */
  staff?: SoldStaffOption[];
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: SoldDealFormValues) => void;
  /**
   * Which flow this is. Defaults to `sale`, so every existing caller is
   * unchanged.
   *
   * A `replacement` records the same information for a policy that replaces
   * one already in our book, so it skips prior insurance entirely; the policy
   * being replaced is stamped on the lead and injected server-side.
   */
  variant?: WizardVariant;
  /**
   * Where in-progress documents are uploaded.
   *
   * Anchored on the lead, whose key prefix is the server's ownership check, so
   * the scope travels with the upload rather than being inferred.
   *
   * ⚠ **Passed in, not derived here.** It used to be computed from the variant,
   * and when a third variant arrived it fell through to
   * `{ kind: "lead", leadId: "" }` — every upload failed the presign, and
   * because the New Business Application is required, the whole flow was
   * unsubmittable. The flow that owns the anchor is the only thing that
   * reliably knows it.
   */
  uploadScope: UploadScope;
}

/** One opening of the policy steps. */
interface DraftSession {
  /**
   * Remount key: a fresh stepper — and so a fresh form, with fresh
   * touched-state — per session. Monotonic, never derived from the list's
   * length, which changes under a live draft whenever a policy is removed.
   */
  key: number;
  /** The committed policy being replaced, or `null` for a new one. */
  editingIndex: number | null;
}

/**
 * The Sold form: one sale, one sold date, any number of policies (PAC-40).
 *
 * ## The shape since PAC-104
 *
 * **The sold date is asked once, outside the policy steps**, in a panel that
 * stays on screen and defaults to today. It used to be step 1 of the first
 * policy, which read as a property of that policy and had to be typed on every
 * sale even though it is nearly always today.
 *
 * **The review is the hub.** Each policy runs through a `PolicyDraftStepper`
 * and, when committed, lands here: every policy on the sale with Edit and
 * Remove, "Add another policy", and "Book the sale". Adding or editing opens
 * the stepper again, and **Cancel always returns to the review** with the
 * committed policies untouched. That replaces the old loop card, from which a
 * producer who pressed "Add another policy" could not get back without
 * finishing a whole second policy.
 *
 * It also retires `draftCommitted`, the guard against the old double-commit:
 * a policy is committed exactly once, as its stepper closes, so there is no
 * path back into an already-committed draft to guard.
 */
export function SoldDealWizard({
  context,
  carriers,
  staff = [],
  submitting,
  errorMessage,
  onSubmit,
  variant = "sale",
  uploadScope,
}: SoldDealWizardProps) {
  /**
   * Today, in the producer's own time zone — see `localTodayYmd` for why not
   * `toISOString()`. The initial value is kept so a date nobody touched does not
   * count as unsaved work.
   */
  const [initialSoldDate] = useState(localTodayYmd);
  const [soldDate, setSoldDate] = useState(initialSoldDate);
  const [policies, setPolicies] = useState<SoldPolicyFormValues[]>([]);

  const sessionSeq = useRef(0);
  /** The open policy steps, or `null` while the review is showing. */
  const [draft, setDraft] = useState<DraftSession | null>({
    key: 0,
    editingIndex: null,
  });
  const [draftDirty, setDraftDirty] = useState(false);

  const dirty =
    soldDate !== initialSoldDate || policies.length > 0 || draftDirty;

  /**
   * Guard a hard reload / tab close.
   *
   * NOT `useBlocker`: the app mounts `<BrowserRouter>`, which is not a data
   * router, and `useBlocker` throws an invariant there — it would take the
   * whole wizard down at runtime. Migrating to `createBrowserRouter` is its own
   * ticket.
   */
  useEffect(() => {
    if (!dirty || submitting) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, submitting]);

  const openDraft = (editingIndex: number | null) => {
    sessionSeq.current += 1;
    setDraft({ key: sessionSeq.current, editingIndex });
    setDraftDirty(false);
  };

  const closeDraft = () => {
    setDraft(null);
    setDraftDirty(false);
  };

  /**
   * Fold a finished policy into the sale and return to the review.
   *
   * An edited policy **replaces** the row it came from rather than appending:
   * order is user-visible on the list they are about to book, so an edited
   * policy must not jump to the end.
   */
  const commitPolicy = (values: SoldPolicyFormValues) => {
    const editingIndex = draft?.editingIndex ?? null;
    setPolicies((prev) =>
      editingIndex === null
        ? [...prev, values]
        : prev.map((policy, index) => (index === editingIndex ? values : policy)),
    );
    closeDraft();
  };

  const removePolicy = (index: number) => {
    setPolicies((prev) => prev.filter((_, i) => i !== index));
    // Keep an open edit pointing at the same policy. `key` is deliberately left
    // alone: remounting the stepper here would wipe what is being typed.
    setDraft((current) => {
      if (!current || current.editingIndex === null) return current;
      if (current.editingIndex === index) {
        return { ...current, editingIndex: null };
      }
      return current.editingIndex > index
        ? { ...current, editingIndex: current.editingIndex - 1 }
        : current;
    });
  };

  const bookIssues: CardIssue[] = [
    ...(soldDate ? [] : [{ path: "soldDate", message: "Enter the sold date" }]),
    ...(policies.length
      ? []
      : [{ path: "policies", message: "Add at least one policy" }]),
  ];

  const finish = () => {
    if (bookIssues.length) return;
    onSubmit({ soldDate, policies });
  };

  const editingIndex = draft?.editingIndex ?? null;

  return (
    <div className="space-y-4">
      <FormSection>
        <p className="text-xs text-muted-foreground">
          Recording a sale for{" "}
          <span className="text-foreground">{context.primaryContactName}</span>
          {context.householdName && <> · {context.householdName}</>}
        </p>
        <SoldDateCard
          value={soldDate}
          onChange={setSoldDate}
          disabled={submitting}
        />
      </FormSection>

      {draft ? (
        <PolicyDraftStepper
          key={draft.key}
          variant={variant}
          context={context}
          carriers={carriers}
          staff={staff}
          uploadScope={uploadScope}
          initialValues={
            editingIndex !== null ? policies[editingIndex] : undefined
          }
          position={
            editingIndex !== null ? editingIndex + 1 : policies.length + 1
          }
          commitLabel={editingIndex !== null ? "Save policy" : "Add to sale"}
          busy={submitting}
          onCommit={commitPolicy}
          // Nowhere to return to on the very first policy of a sale.
          onCancel={
            policies.length > 0 || editingIndex !== null
              ? closeDraft
              : undefined
          }
          onDirtyChange={setDraftDirty}
        />
      ) : (
        <FormSection>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              Review the sale
            </h2>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {policies.length === 1
                ? "1 policy"
                : `${policies.length} policies`}
            </p>
          </div>

          {policies.length ? (
            <>
              <p className="text-sm text-muted-foreground">
                Check it over — booking creates the deal, its policies and the
                service hand-off.
              </p>
              <PolicyReviewList
                policies={policies}
                onEdit={openDraft}
                onRemove={removePolicy}
                disabled={submitting}
              />
            </>
          ) : (
            <p className="text-sm text-destructive">
              Every policy has been removed. Add one before booking.
            </p>
          )}

          <FormError icon>{errorMessage}</FormError>

          <BlockedReasons
            issues={bookIssues}
            title="Still needed before you can book"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={() => openDraft(null)}
            >
              <Plus size={14} />
              {policies.length ? "Add another policy" : "Add a policy"}
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={submitting || bookIssues.length > 0}
              onClick={finish}
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {submitting ? "Booking…" : "Book the sale"}
            </Button>
          </div>
        </FormSection>
      )}

      {/*
       * The running tally while a policy is being entered — the review renders
       * the same policies in full, and showing both would be the list twice.
       */}
      {draft && (
        <PolicySummaryList
          policies={policies}
          disabled={submitting}
          onRemove={removePolicy}
        />
      )}
    </div>
  );
}
