import type {
  CarrierOption,
  SoldDealLeadContext,
  SoldStaffOption,
} from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FormError, FormSection } from "@/components/form";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/hooks/form";
import type { UploadScope } from "@/lib/sold-deals-api";
import { BlockedReasons } from "./BlockedReasons";
import { DiscountsCard } from "./DiscountsCard";
import {
  blockingIssues,
  buildSoldPolicySchema,
  cardsFor,
  emptyPolicy,
  type CardIssue,
  type SoldPolicyFormValues,
  type WizardVariant,
} from "./sold-deal-schema";
import { TransferFromCard } from "./TransferFromCard";
import { useWizardNavigation } from "./useWizardNavigation";
import {
  NewBusinessApplicationCard,
  PolicyDetailsCard,
  PolicyFinancialsCard,
  PolicyTypeCard,
  PriorInsuranceCard,
} from "./WizardCards";
import { WizardProgress } from "./WizardProgress";

interface PolicyDraftStepperProps {
  variant: WizardVariant;
  context: SoldDealLeadContext;
  /** The carrier catalog. Callers wait for it, so it is never mid-flight here. */
  carriers: CarrierOption[];
  /** Agency staff for the "Cancelled by" picker (PAC-65 #11). */
  staff: SoldStaffOption[];
  /** Where in-progress documents are uploaded — see `UploadScope`. */
  uploadScope: UploadScope;
  /** The household the transfer variant's from-policy picker searches. */
  householdId?: string | null;
  /**
   * The policy being edited, or omitted for a new one.
   *
   * Read **once**, at mount: the caller remounts the stepper (via `key`) for
   * every policy it opens, which is what gives each one fresh values *and*
   * fresh touched-state.
   */
  initialValues?: SoldPolicyFormValues;
  /** 1-based position of this policy on the sale, for the progress header. */
  position: number;
  /** The last step's button — "Add to sale", "Save policy". */
  commitLabel: string;
  /** The committed policy is being saved somewhere; freezes every control. */
  busy?: boolean;
  errorMessage?: string | null;
  onCommit: (values: SoldPolicyFormValues) => void;
  /**
   * Leave without committing. Omit when there is nowhere to go back to — the
   * first policy of a new sale — and Back is disabled on the first step instead.
   */
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The steps of one policy — type, details, financials, paperwork, discounts,
 * prior insurance — ending in a commit (PAC-104).
 *
 * Extracted from `SoldDealWizard` so the Edit sale page can add a policy to a
 * booked deal with exactly the cards, rules and uploads the sale was booked
 * with. It knows nothing about the sale around it: where the committed policy
 * goes, and where Cancel leads, are the caller's.
 *
 * ## Leaving is always possible once there is somewhere to go
 *
 * This is the fix for the complaint that started PAC-104. The old wizard ran
 * every policy through one history stack, so after "Add another policy" Back
 * only ever reached the loop card — which checked the *empty* draft and
 * disabled both of its buttons. The only way out was to finish a whole second
 * policy and delete it on the review. With `onCancel`, Back on the first step
 * and the Cancel button both return to the caller, confirming only when there
 * is input to lose.
 *
 * Stepping Back *within* a policy asks nothing: the values live in the form,
 * not in the mounted card, so returning to a previous step loses nothing.
 */
export function PolicyDraftStepper({
  variant,
  context,
  carriers,
  staff,
  uploadScope,
  householdId,
  initialValues,
  position,
  commitLabel,
  busy = false,
  errorMessage,
  onCommit,
  onCancel,
  onDirtyChange,
}: PolicyDraftStepperProps) {
  const cards = useMemo(() => cardsFor(variant), [variant]);
  const nav = useWizardNavigation(cards);
  const editing = initialValues !== undefined;

  /**
   * The schema is rebuilt whenever the carrier catalog changes (PAC-56 #20 keys
   * the policy-number rule off it). `useForm` re-applies its options on every
   * render, so the new validator is live on the next validation run.
   */
  const schema = useMemo(
    () => buildSoldPolicySchema(carriers, variant),
    [carriers, variant],
  );

  /**
   * Held in state, not rebuilt per render.
   *
   * `FormApi.update` compares `defaultValues` **structurally** and resets an
   * untouched form when they differ, so a fresh object per render is only safe
   * while the factory is deterministic. Reading the seed once also sidesteps
   * the array-field trap in `docs/tanstack-form-spike-findings.md`: the values
   * are there before the first render, so `form.reset` is never needed to load
   * a policy for editing — and `reset` does not redraw
   * `discounts.defensiveDriver.drivers`.
   */
  const [defaultValues] = useState<SoldPolicyFormValues>(() =>
    initialValues ? structuredClone(initialValues) : emptyPolicy(variant),
  );

  /**
   * `onBlur` is the only validator key that both surfaces errors on blur —
   * which is the behaviour these cards were built with — and answers the
   * `"submit"`-cause validation the commit runs.
   */
  const form = useAppForm({
    defaultValues,
    validators: { onBlur: schema },
  });

  const dirty = useStore(form.store, (s) => s.isDirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /**
   * Why the current step will not let the producer move on — empty when it will.
   *
   * Read off the schema rather than field meta; see `blockingIssues`. The last
   * step is checked against the **whole** policy, because its button commits
   * all of it.
   */
  const values = useStore(form.store, (s) => s.values);
  const blocking = useMemo<CardIssue[]>(
    () => blockingIssues(schema, nav.atEnd ? "all" : nav.card, values),
    [schema, nav.atEnd, nav.card, values],
  );
  const blocked = blocking.length > 0;

  const [discardOpen, setDiscardOpen] = useState(false);

  const commit = async () => {
    await form.validate("submit");
    if (!form.state.isValid) return;
    // Cloned, not referenced: the committed policy must not be able to follow
    // anything that later writes to this form's values.
    onCommit(structuredClone(form.state.values));
  };

  const leave = () => {
    if (!onCancel) return;
    if (dirty) setDiscardOpen(true);
    else onCancel();
  };

  return (
    <>
      <FormSection>
        <WizardProgress
          card={nav.card}
          cards={cards}
          position={position}
          editing={editing}
        />

        <form.AppForm>
          <div className="space-y-4">
            {nav.card === "transferFrom" && (
              <TransferFromCard form={form} householdId={householdId ?? null} />
            )}
            {nav.card === "policyType" && <PolicyTypeCard form={form} />}
            {nav.card === "policyDetails" && (
              <PolicyDetailsCard form={form} carriers={carriers} />
            )}
            {nav.card === "financials" && <PolicyFinancialsCard form={form} />}
            {nav.card === "application" && (
              <NewBusinessApplicationCard
                form={form}
                uploadScope={uploadScope}
              />
            )}
            {nav.card === "discounts" && (
              <DiscountsCard
                form={form}
                uploadScope={uploadScope}
                contacts={context.contacts}
              />
            )}
            {nav.card === "priorInsurance" && (
              <PriorInsuranceCard
                form={form}
                carriers={carriers}
                staff={staff}
                uploadScope={uploadScope}
              />
            )}
          </div>
        </form.AppForm>

        <FormError icon>{errorMessage}</FormError>

        <BlockedReasons issues={blocking} />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || (nav.atStart && !onCancel)}
            onClick={() => (nav.atStart ? leave() : nav.back())}
          >
            <ArrowLeft size={14} />
            Back
          </Button>

          <div className="flex flex-wrap gap-2">
            {onCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={leave}
              >
                {editing ? "Cancel edit" : "Cancel policy"}
              </Button>
            )}

            {nav.atEnd ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || blocked}
                onClick={() => void commit()}
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                {commitLabel}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={busy || blocked}
                onClick={nav.advance}
              >
                Continue
                <ArrowRight size={14} />
              </Button>
            )}
          </div>
        </div>
      </FormSection>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {editing ? "Discard your changes?" : "Discard this policy?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {editing
                ? "The policy stays on the sale as it was before you started editing."
                : "What you entered for this policy won't be added. Policies already on the sale are kept."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardOpen(false);
                onCancel?.();
              }}
            >
              {editing ? "Discard changes" : "Discard policy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
