import { zodResolver } from "@hookform/resolvers/zod";
import type { SoldDealLeadContext } from "@sfa/shared";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Plus, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { PolicySummaryList } from "./PolicySummaryList";
import { DiscountsCard } from "./DiscountsCard";
import {
  CARD_FIELDS,
  emptyPolicy,
  soldPolicySchema,
  type SoldPolicyFormValues,
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
   */
  const draft = useForm<SoldPolicyFormValues>({
    resolver: zodResolver(soldPolicySchema),
    defaultValues: emptyPolicy(),
    mode: "onBlur",
  });

  const dirty = Boolean(soldDate) || policies.length > 0 || draft.formState.isDirty;

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
    const fields = CARD_FIELDS[nav.card];
    const valid = await draft.trigger(
      fields as Parameters<typeof draft.trigger>[0],
    );
    if (valid) nav.advance();
  };

  /** Card 8 — commit the draft, then either loop or submit. */
  const commitDraft = async (): Promise<SoldPolicyFormValues[] | null> => {
    const valid = await draft.trigger();
    if (!valid) return null;
    const next = [...policies, draft.getValues()];
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
      <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
        <WizardProgress card={nav.card} policyCount={policies.length} />

        <p className="text-xs text-muted-foreground">
          Recording a sale for{" "}
          <span className="text-foreground">{context.primaryContactName}</span>
          {context.householdName && <> · {context.householdName}</>}
        </p>

        <Form {...draft}>
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
            {nav.card === "policyType" && <PolicyTypeCard />}
            {nav.card === "policyDetails" && <PolicyDetailsCard />}
            {nav.card === "financials" && <PolicyFinancialsCard />}
            {nav.card === "discounts" && (
              <DiscountsCard
                leadId={context.leadId}
                contacts={context.contacts}
              />
            )}
            {nav.card === "priorInsurance" && <PriorInsuranceCard />}
            {nav.card === "cancellation" && <CancellationCard />}
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
        </Form>

        {errorMessage && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-500" />
            {errorMessage}
          </p>
        )}

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
      </section>

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
