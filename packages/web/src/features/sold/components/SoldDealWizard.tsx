import type { SoldDealLeadContext } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { ArrowLeft, ArrowRight, Loader2, Plus, Send } from "lucide-react";
import { useEffect, useState } from "react";
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
import { PolicySummaryList } from "./PolicySummaryList";
import { DiscountsCard } from "./DiscountsCard";
import {
  CARD_FIELDS,
  emptyPolicy,
  soldPolicySchema,
  type SoldPolicyFormValues,
  type WizardCard,
} from "./sold-deal-schema";
import { useWizardNavigation } from "./useWizardNavigation";
import {
  CancellationCard,
  PolicyDetailsCard,
  PolicyFinancialsCard,
  PolicyTypeCard,
  PriorInsuranceCard,
  SoldDateCard,
} from "./WizardCards";
import { WizardProgress } from "./WizardProgress";

interface SoldDealWizardProps {
  context: SoldDealLeadContext;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: {
    soldDate: string;
    policies: SoldPolicyFormValues[];
  }) => void;
}

/**
 * The field paths the form has registered, with their key type recovered.
 *
 * `Object.keys` is typed `string[]` even over a `Partial<Record<DeepKeys<T>, …>>`
 * — a TypeScript soundness gap, not a modelling one. Unlike the hardcoded paths
 * this refactor removed, every key here came from the form itself, so there is
 * no path here for the compiler to be wrong about.
 */
function fieldPaths<T extends object>(fieldMeta: T): Array<keyof T> {
  return Object.keys(fieldMeta) as Array<keyof T>;
}

export function SoldDealWizard({
  context,
  submitting,
  errorMessage,
  onSubmit,
}: SoldDealWizardProps) {
  const nav = useWizardNavigation();
  const [soldDate, setSoldDate] = useState("");
  const [soldDateError, setSoldDateError] = useState<string>();
  const [policies, setPolicies] = useState<SoldPolicyFormValues[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);

  /**
   * The **draft** policy — its own form, remounted per policy via `key` below.
   *
   * This separation is what keeps Cards 2–7 isolated across loop iterations:
   * a single array-backed form would revalidate finished policies on every
   * keystroke and leak `onBlur` touched-state, so entering policy 2 would light
   * up policy 1's errors.
   *
   * `onBlur` is the only validator key that both surfaces errors on blur — which
   * is the behaviour these cards were built with — and answers the
   * `"submit"`-cause `validateField` that per-card validation runs on.
   */
  const draft = useAppForm({
    defaultValues: emptyPolicy(),
    validators: { onBlur: soldPolicySchema },
  });

  const draftDirty = useStore(draft.store, (s) => s.isDirty);
  const dirty = Boolean(soldDate) || policies.length > 0 || draftDirty;

  /**
   * Guard a hard reload / tab close.
   *
   * NOT `useBlocker`: the app mounts `<BrowserRouter>`, which is not a data
   * router, and `useBlocker` throws an invariant there — it would take the
   * whole wizard down at runtime. In-app navigation is guarded by the confirm
   * dialog on Back instead. Migrating to `createBrowserRouter` is its own
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

  /**
   * Is this card's slice of the draft valid?
   *
   * Two traps, both found by the spike (`docs/tanstack-form-spike-findings.md`)
   * and both silent if you get them wrong:
   *
   * 1. **`validateField`'s return value is unreliable.** On a *mounted* field it
   *    reports `[]` even when the field is invalid. The validation does run; the
   *    verdict has to be read back out of field meta, which is what the final
   *    scan below does.
   * 2. **`validateAllFields` only walks mounted fields**, so it can never stand
   *    in for a whole-form check in a wizard that mounts one card at a time.
   */
  const validateCard = async (card: WizardCard) => {
    const roots = CARD_FIELDS[card];
    if (roots.length === 0) return true;

    const owns = (path: string) =>
      roots.some(
        (root) =>
          path === root ||
          path.startsWith(`${root}.`) ||
          path.startsWith(`${root}[`),
      );

    /*
     * `CARD_FIELDS` entries are prefixes, and touching only those would leave a
     * blank driver row blocking Continue with no message against it: zod reports
     * that at `…drivers[0].name`, which no static list can name. So the declared
     * roots are joined by every path the form has actually registered beneath
     * them. `validateField` marks each one touched, which is what lets a blocked
     * step show its errors at all.
     */
    const paths = new Set([
      ...roots,
      ...fieldPaths(draft.state.fieldMeta).filter(owns),
    ]);
    await Promise.all([...paths].map((path) => draft.validateField(path, "submit")));

    // One authoritative form-level run, so a path that errors without a mounted
    // field still lands in meta before the scan.
    await draft.validate("submit");

    return !Object.entries(draft.state.fieldMeta).some(
      ([path, meta]) => owns(path) && (meta?.errors.length ?? 0) > 0,
    );
  };

  const advanceFromCard = async () => {
    if (nav.card === "soldDate") {
      if (!soldDate) {
        setSoldDateError("Enter the sold date");
        return;
      }
      setSoldDateError(undefined);
      nav.advance();
      return;
    }

    // The card→field map means adding a card cannot forget to validate it.
    if (await validateCard(nav.card)) nav.advance();
  };

  /** Card 8 — commit the draft, then either loop or submit. */
  const commitDraft = async (): Promise<SoldPolicyFormValues[] | null> => {
    await draft.validate("submit");
    if (!draft.state.isValid) return null;
    // Cloned, not referenced: `draft.reset` below hands the next policy a fresh
    // values object, and a committed policy must not be able to follow it.
    const next = [...policies, structuredClone(draft.state.values)];
    setPolicies(next);
    return next;
  };

  const addAnother = async () => {
    const next = await commitDraft();
    if (!next) return;
    draft.reset(emptyPolicy());
    nav.restartLoop();
  };

  const finish = async () => {
    const next = await commitDraft();
    if (!next) return;
    onSubmit({ soldDate, policies: next });
  };

  return (
    <div className="space-y-4">
      <FormSection>
        <WizardProgress card={nav.card} policyCount={policies.length} />

        <p className="text-xs text-muted-foreground">
          Recording a sale for{" "}
          <span className="text-foreground">{context.primaryContactName}</span>
          {context.householdName && <> · {context.householdName}</>}
        </p>

        <draft.AppForm>
          {/*
            * `key` remounts the draft form for each policy, which resets both
            * values and touched-state — the mechanism behind the isolation
            * described above.
            */}
          <div key={policies.length} className="space-y-4">
            {nav.card === "soldDate" && (
              <SoldDateCard
                value={soldDate}
                error={soldDateError}
                onChange={(value) => {
                  setSoldDate(value);
                  setSoldDateError(undefined);
                }}
              />
            )}
            {nav.card === "policyType" && <PolicyTypeCard form={draft} />}
            {nav.card === "policyDetails" && <PolicyDetailsCard form={draft} />}
            {nav.card === "financials" && <PolicyFinancialsCard form={draft} />}
            {nav.card === "discounts" && (
              <DiscountsCard
                form={draft}
                leadId={context.leadId}
                contacts={context.contacts}
              />
            )}
            {nav.card === "priorInsurance" && <PriorInsuranceCard form={draft} />}
            {nav.card === "cancellation" && <CancellationCard form={draft} />}
            {nav.card === "loop" && (
              <div className="space-y-2">
                <p className="text-sm text-foreground">
                  Add another policy to this sale?
                </p>
                <p className="text-xs text-muted-foreground">
                  Everything entered so far is submitted together as one deal.
                </p>
              </div>
            )}
          </div>
        </draft.AppForm>

        <FormError icon>{errorMessage}</FormError>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={nav.atStart || submitting}
            onClick={() => (dirty ? setDiscardOpen(true) : nav.back())}
          >
            <ArrowLeft size={14} />
            Back
          </Button>

          {nav.card === "loop" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => void addAnother()}
              >
                <Plus size={14} />
                Add another policy
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={submitting}
                onClick={() => void finish()}
              >
                {submitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                {submitting ? "Booking…" : "Book the sale"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={submitting}
              onClick={() => void advanceFromCard()}
            >
              Continue
              <ArrowRight size={14} />
            </Button>
          )}
        </div>
      </FormSection>

      <PolicySummaryList
        policies={policies}
        disabled={submitting}
        onRemove={(index) =>
          setPolicies((prev) => prev.filter((_, i) => i !== index))
        }
      />

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Go back a step?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything entered on this card may be lost. Policies already added
              to the sale are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay here</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDiscardOpen(false);
                nav.back();
              }}
            >
              Go back
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
