import type { UploadScope } from "@/lib/sold-deals-api";
import type { CarrierOption, SoldDealLeadContext } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { ArrowLeft, ArrowRight, Loader2, Plus, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { PolicyReviewList } from "./PolicyReviewList";
import { PolicySummaryList } from "./PolicySummaryList";
import { DiscountsCard } from "./DiscountsCard";
import {
  blockingIssues,
  buildSoldPolicySchema,
  cardsFor,
  emptyPolicy,
  type CardIssue,
  type SoldDealFormValues,
  type SoldPolicyFormValues,
  type WizardVariant,
} from "./sold-deal-schema";
import { useWizardNavigation } from "./useWizardNavigation";
import {
  NewBusinessApplicationCard,
  PolicyDetailsCard,
  PolicyFinancialsCard,
  PolicyTypeCard,
  PriorInsuranceCard,
  SoldDateCard,
} from "./WizardCards";
import { TransferFromCard } from "./TransferFromCard";
import { WizardProgress } from "./WizardProgress";

interface SoldDealWizardProps {
  context: SoldDealLeadContext;
  /** The carrier catalog. The page waits for it, so it is never mid-flight here. */
  carriers: CarrierOption[];
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: SoldDealFormValues) => void;
  /**
   * Which flow this is. Defaults to `sale`, so every existing caller is
   * unchanged.
   *
   * A `transfer` records the same information against a household and a CRM
   * ticket instead of a lead: it asks which policy each new one replaces, and
   * skips prior insurance entirely.
   */
  variant?: WizardVariant;
  /**
   * The household whose policies the from-policy picker searches. Required by
   * the transfer variant and unused by the sale.
   */
  householdId?: string | null;
  /** The ticket a transfer is recorded from; also its upload anchor. */
  ticketId?: string;
}

export function SoldDealWizard({
  context,
  carriers,
  submitting,
  errorMessage,
  onSubmit,
  variant = "sale",
  householdId,
  ticketId,
}: SoldDealWizardProps) {
  const nav = useWizardNavigation(variant);
  const [soldDate, setSoldDate] = useState("");
  const [policies, setPolicies] = useState<SoldPolicyFormValues[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  /**
   * Remount key for the draft subtree.
   *
   * ⚠ **Monotonic, not `policies.length`.** The original keyed the remount on
   * the array's length, which was safe only while the array grew by exactly one
   * at a commit point. It is now mutated in other ways too, and any of those
   * would silently remount the live draft and wipe whatever the producer had
   * typed — an intermittent "the wizard cleared my form" bug that is very hard
   * to reproduce on demand. Bump this **only** where a genuinely fresh policy
   * starts. Same pattern as `QuoteRecapForm`'s `editorKey`.
   */
  const [draftKey, setDraftKey] = useState(0);
  /**
   * Which committed policy the draft is replacing, or `null` for a new one.
   *
   * Set by the review card's Edit. Without it, editing a policy would splice it
   * out and re-append it at the end of a list the producer is reading.
   */
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  /** Guards the double-commit described on `commitDraft`. */
  const [draftCommitted, setDraftCommitted] = useState(false);

  /**
   * The **draft** policy — its own form, remounted per policy via `key` below.
   *
   * This separation is what keeps the per-policy cards isolated across loop
   * iterations:
   * a single array-backed form would revalidate finished policies on every
   * keystroke and leak `onBlur` touched-state, so entering policy 2 would light
   * up policy 1's errors.
   *
   * `onBlur` is the only validator key that both surfaces errors on blur — which
   * is the behaviour these cards were built with — and answers the
   * `"submit"`-cause `validateField` that per-card validation runs on.
   *
   * The schema is rebuilt whenever the carrier catalog changes (PAC-56 #20 keys
   * the policy-number rule off it). `useForm` re-applies its options on every
   * render, so the new validator is live on the next validation run.
   */
  /**
   * Where in-progress documents are uploaded.
   *
   * The two flows anchor keys differently on the server — a sale on its lead, a
   * transfer on the ticket's household — and that prefix is the ownership
   * check, so the scope travels with the upload rather than being inferred.
   */
  const uploadScope: UploadScope = useMemo(
    () =>
      variant === "transfer" && ticketId
        ? { kind: "ticket", ticketId }
        : { kind: "lead", leadId: context.leadId },
    [variant, ticketId, context.leadId],
  );
  const cards = useMemo(() => cardsFor(variant), [variant]);
  const schema = useMemo(
    () => buildSoldPolicySchema(carriers, variant),
    [carriers, variant],
  );

  /**
   * Hoisted out of the `useAppForm` call deliberately.
   *
   * `FormApi.update` compares `defaultValues` **structurally** and resets an
   * untouched form when they differ. A fresh `emptyPolicy()` per render survives
   * that only because the factory is deterministic — the day someone defaults
   * `effectiveDate` to today's date, every render would silently wipe the form.
   * Memoizing turns that from an emergent property into a guaranteed one.
   */
  const defaults = useMemo(() => emptyPolicy(variant), [variant]);

  const draft = useAppForm({
    defaultValues: defaults,
    validators: { onBlur: schema },
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
   * Why the current card will not let the producer move on — empty when it will.
   *
   * ## Read off the schema, not off field meta
   *
   * This replaced a scan of `draft.state.fieldMeta` for errors under the card's
   * roots, which was answering the wrong question. `FormApi.validateSync` writes
   * form-level errors onto **every** path in the schema's error map with no
   * mount check, so a rule failing behind a control the current card does not
   * render blocked Continue while displaying nothing — and the wizard had no way
   * to tell that had happened. Three ways in, all confirmed: a discount ticked
   * on one policy-type branch and then switched to the other, a half-typed
   * escrow block left behind by un-ticking the box, and the escrow rule's own
   * message, which was reported at a path nothing is bound to.
   *
   * Both of those causes are fixed at the source now (`clearInapplicableDiscounts`
   * and the escrow lifecycle in `DiscountsCard`), but the gate should not have
   * been able to fail invisibly in the first place. Parsing the values makes the
   * verdict independent of what happens to be mounted **and** hands back the
   * reasons, which is what the footer shows — so a blocked card can always say
   * what it is waiting for.
   *
   * It also retires both traps in `docs/tanstack-form-spike-findings.md`: with
   * nothing read back out of meta, `validateField`'s unreliable return value and
   * `validateAllFields`' mounted-only walk stop being relevant here.
   */
  const draftValues = useStore(draft.store, (s) => s.values);
  const blocking = useMemo<CardIssue[]>(() => {
    // The one field outside the draft form, so it is checked outside the schema.
    if (nav.card === "soldDate") {
      return soldDate ? [] : [{ path: "soldDate", message: "Enter the sold date" }];
    }
    return blockingIssues(schema, nav.card, draftValues);
  }, [nav.card, soldDate, schema, draftValues]);

  const blocked = blocking.length > 0;

  /**
   * Fold the draft into the committed list.
   *
   * ⚠ **Not idempotent on its own** — hence `draftCommitted`. Before the review
   * card, `commitDraft` ran once per journey and reset immediately afterwards.
   * Now the producer can reach review, go Back, and press "Review & book"
   * again, which would append the same policy twice. The flag is cleared
   * wherever a genuinely new or reloaded draft starts.
   *
   * When `editingIndex` is set the policy **replaces** the row it came from
   * rather than appending. Order is user-visible on the list they are about to
   * book, so an edited policy must not jump to the end.
   */
  const commitDraft = async (): Promise<SoldPolicyFormValues[] | null> => {
    if (draftCommitted) return policies;

    await draft.validate("submit");
    if (!draft.state.isValid) return null;

    // Cloned, not referenced: `draft.reset` hands the next policy a fresh
    // values object, and a committed policy must not be able to follow it.
    const committed = structuredClone(draft.state.values);
    const next =
      editingIndex === null
        ? [...policies, committed]
        : policies.map((policy, index) =>
            index === editingIndex ? committed : policy,
          );

    setPolicies(next);
    setDraftCommitted(true);
    return next;
  };

  const addAnother = async () => {
    const next = await commitDraft();
    if (!next) return;
    startFreshDraft();
    nav.restartLoop();
  };

  /**
   * Begin a genuinely new policy: clear the values *and* remount the subtree.
   *
   * Both halves matter. `reset` clears values; the remount is what drops the
   * touched-state, without which policy 2 opens showing policy 1's errors.
   */
  const startFreshDraft = () => {
    draft.reset(emptyPolicy(variant));
    setDraftKey((key) => key + 1);
    setEditingIndex(null);
    setDraftCommitted(false);
  };

  /** Pull a committed policy back into the draft, to be replaced in place. */
  const editPolicy = (index: number) => {
    const existing = policies[index];
    if (!existing) return;
    draft.reset(structuredClone(existing));
    setDraftKey((key) => key + 1);
    setEditingIndex(index);
    setDraftCommitted(false);
    nav.restartLoop();
  };

  const removePolicy = (index: number) => {
    setPolicies((prev) => prev.filter((_, i) => i !== index));
    // The draft is untouched — `draftKey` is not bumped, which is exactly the
    // bug the counter replaced `policies.length` to avoid.
    setEditingIndex((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  };

  /** Commit whatever is in the draft, then show the review card. */
  const reviewSale = async () => {
    const next = await commitDraft();
    if (!next) return;
    nav.advance();
  };

  const finish = () => {
    if (!policies.length) return;
    onSubmit({ soldDate, policies });
  };

  return (
    <div className="space-y-4">
      <FormSection>
        <WizardProgress
          card={nav.card}
          cards={cards}
          policyCount={policies.length}
        />

        <p className="text-xs text-muted-foreground">
          Recording a sale for{" "}
          <span className="text-foreground">{context.primaryContactName}</span>
          {context.householdName && <> · {context.householdName}</>}
        </p>

        <draft.AppForm>
          {/*
           * `key` remounts the draft form for each policy, which resets both
           * values and touched-state — the mechanism behind the isolation
           * described above. See `draftKey` for why it is a counter.
           */}
          <div key={draftKey} className="space-y-4">
            {nav.card === "soldDate" && (
              <SoldDateCard value={soldDate} onChange={setSoldDate} />
            )}
            {nav.card === "transferFrom" && (
              <TransferFromCard form={draft} householdId={householdId ?? null} />
            )}
            {nav.card === "policyType" && <PolicyTypeCard form={draft} />}
            {nav.card === "policyDetails" && (
              <PolicyDetailsCard form={draft} carriers={carriers} />
            )}
            {nav.card === "financials" && <PolicyFinancialsCard form={draft} />}
            {nav.card === "application" && (
              <NewBusinessApplicationCard
                form={draft}
                uploadScope={uploadScope}
              />
            )}
            {nav.card === "discounts" && (
              <DiscountsCard
                form={draft}
                uploadScope={uploadScope}
                contacts={context.contacts}
              />
            )}
            {nav.card === "priorInsurance" && (
              <PriorInsuranceCard
            form={draft}
            carriers={carriers}
            uploadScope={uploadScope}
          />
            )}
            {nav.card === "loop" && (
              <div className="space-y-2">
                <p className="text-base text-foreground">
                  Add another policy to this sale?
                </p>
                <p className="text-sm text-muted-foreground">
                  Everything entered so far is submitted together as one deal.
                </p>
              </div>
            )}
          </div>
        </draft.AppForm>

        {/*
         * Outside the draft form: it reads the **committed** list, and nothing
         * on it is bound to the draft. Inside the keyed subtree it would
         * remount on every edit for no reason.
         */}
        {nav.card === "review" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sold {soldDate || "—"} ·{" "}
              {policies.length === 1
                ? "1 policy"
                : `${policies.length} policies`}
              . Check it over — booking creates the deal, its policies and the
              service hand-off.
            </p>
            {policies.length ? (
              <PolicyReviewList
                policies={policies}
                onEdit={editPolicy}
                onRemove={removePolicy}
                disabled={submitting}
              />
            ) : (
              <p className="text-sm text-destructive">
                Every policy has been removed. Add one before booking.
              </p>
            )}
          </div>
        )}

        <FormError icon>{errorMessage}</FormError>

        {/*
         * Why the button below is greyed out.
         *
         * Load-bearing, not decoration. Disabling the only way forward without
         * saying why is the trap this replaces: the old button was always
         * enabled and clicking it was what marked fields touched, so the reasons
         * appeared *because* you pressed it. Nothing marks them touched now, so
         * an untouched card would grey the button and show nothing at all.
         *
         * Messages come from the schema, so a rule whose field is not on the
         * current card still surfaces here instead of jamming the wizard
         * silently — which is what the whole class of bug looked like.
         */}
        <BlockedReasons issues={blocking} />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={nav.atStart || submitting}
            /*
             * Only warn when the *draft* has unsaved input. `dirty` also counts
             * a non-empty policy list and a sold date, so on the review card —
             * where nothing was entered — it fired every time and told the
             * producer they might lose work they had already committed.
             */
            onClick={() => (draftDirty ? setDiscardOpen(true) : nav.back())}
          >
            <ArrowLeft size={14} />
            Back
          </Button>

          {nav.card === "loop" && (
            <div className="flex flex-wrap gap-2">
              {/*
               * Both commit the draft, and `commitDraft` returning `null` was
               * the same dead-button failure one step further on — so they are
               * disabled on the *whole* draft rather than on this card's own
               * fields, which it has none of.
               */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting || blocked}
                onClick={() => void addAnother()}
              >
                <Plus size={14} />
                Add another policy
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={submitting || blocked}
                onClick={() => void reviewSale()}
              >
                Review &amp; book
                <ArrowRight size={14} />
              </Button>
            </div>
          )}

          {nav.card === "review" && (
            <Button
              type="button"
              size="sm"
              disabled={submitting || policies.length === 0}
              onClick={finish}
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {submitting ? "Booking…" : "Book the sale"}
            </Button>
          )}

          {nav.card !== "loop" && nav.card !== "review" && (
            <Button
              type="button"
              size="sm"
              disabled={submitting || blocked}
              onClick={() => nav.advance()}
            >
              Continue
              <ArrowRight size={14} />
            </Button>
          )}
        </div>
      </FormSection>

      {/*
       * The running tally, during the loop only — the review card renders the
       * same policies in full, and showing both would be the list twice.
       */}
      {nav.card !== "review" && (
        <PolicySummaryList
          policies={policies}
          disabled={submitting}
          onRemove={removePolicy}
        />
      )}

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

/** How many reasons to spell out before collapsing the rest into a count. */
const MAX_LISTED_REASONS = 4;

/**
 * What the card is still waiting for.
 *
 * Muted rather than destructive: nothing has gone *wrong* on a card the
 * producer has not filled in yet, and painting a blank Financials card red on
 * arrival would be scolding them for not having typed yet. The per-field
 * messages still turn red on blur, which is where the failure actually is.
 */
function BlockedReasons({ issues }: { issues: CardIssue[] }) {
  if (issues.length === 0) return null;
  const listed = issues.slice(0, MAX_LISTED_REASONS);
  const hidden = issues.length - listed.length;

  return (
    <div
      // Polite, not assertive: it updates on every keystroke as the producer
      // works through the card, and an assertive region would interrupt them
      // each time.
      aria-live="polite"
      className="rounded-md border border-border bg-sunken px-3 py-2"
    >
      <p className="text-xs font-medium text-foreground">
        Still needed before you can continue
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {listed.map((issue) => (
          <li key={issue.path} className="text-xs text-muted-foreground">
            {issue.message}
          </li>
        ))}
        {hidden > 0 && (
          <li className="text-xs text-muted-foreground">
            …and {hidden} more
          </li>
        )}
      </ul>
    </div>
  );
}
