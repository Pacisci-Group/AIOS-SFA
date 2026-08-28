import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { getHousehold } from "@/lib/households-api";
import {
  CreateTicketDialog,
  type CreateTicketPrefill,
} from "@/features/service/components/CreateTicketDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { DEMO_HOUSEHOLD } from "./demo-household";
import { AddMemberDialog } from "./components/AddMemberDialog";
import { HouseholdHeader } from "./components/HouseholdHeader";
import { StartQuoteDialog } from "./components/StartQuoteDialog";
import { HouseholdProfile } from "./components/HouseholdProfile";
import { PolicyPortfolio } from "./components/PolicyPortfolio";
import { ActivityFeed } from "./components/ActivityFeed";
import { HouseholdOnboarding } from "./components/HouseholdOnboarding";

/**
 * Household detail. `/clients/:id` renders a live record; the legacy
 * `/clients/demo` route renders `DEMO_HOUSEHOLD` through the *same* components.
 *
 * The child components take a required `household`/`policies` prop precisely so
 * there is no mock fallback for a live record to fall into — a household with a
 * null phone shows an em dash, not the demo household's number.
 *
 * `isDemo` is threaded down separately for the blocks that have no backing data
 * at all (retention score, tags, cross-sell opportunities). Those render only
 * in the demo; on a live record they are omitted rather than fabricated.
 * Removing each gate is the acceptance criterion for wiring the corresponding
 * block to real data. The activity feed reads live tickets and takes `isDemo`
 * only because `/clients/demo` has no household id to query.
 *
 * ## Layout
 *
 * `AppShell` is rendered here, like every other page — this one used to omit it
 * (its docblock claimed "the page renders inside the app shell", which was true
 * of an older layout route that no longer exists), so the whole Household
 * Details screen rendered with **no sidebar at all** and no way back into the
 * app except the browser's back button.
 *
 * The three columns are the mockup's 25/50/25 above `xl`. Below that they stack
 * into one scrolling column: at 1024px the profile rail was already down to its
 * 260px minimum and the policy grid was rendering two cards in ~300px.
 */
export default function HouseholdDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const isDemo = !id || id === "demo";
  const queryClient = useQueryClient();
  const { canRead, canWrite } = usePermissions();
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [startQuoteOpen, setStartQuoteOpen] = useState(false);

  /**
   * Start Quote spans two modules, so it needs both: step 1 lists and creates
   * leads, step 2 writes the recap. A CSR holding `crm_service:read` can reach
   * this page (see `HouseholdRecordsController`) without holding either, and an
   * enabled button that 403s on submit is worse than one that is not offered.
   */
  const canStartQuote = canRead("leads") && canWrite("quote_recaps");

  /**
   * Why "Start quote" is unavailable, when it is — the tooltip on the disabled
   * button.
   *
   * Both cases were previously a live-looking button that silently did nothing,
   * with no console error to find because nothing had gone wrong. The demo one
   * is the common case: `/clients/demo` is the only Household link in the nav,
   * so it is where anyone tries the button first.
   */
  const startQuoteDisabledReason = isDemo
    ? "The demo household isn't a real record — open a live client to start a quote."
    : !canStartQuote
      ? "Needs Leads read and Quote Recaps write."
      : undefined;

  /** The demo household has no record to write against, so neither can these. */
  const demoReason = isDemo
    ? "Not available on the demo household."
    : undefined;

  const query = useQuery({
    queryKey: ["household", id],
    queryFn: () => getHousehold(id as string),
    enabled: !isDemo,
  });

  const household = isDemo ? DEMO_HOUSEHOLD : query.data;

  /**
   * What the New Ticket dialog can fill in from this page.
   *
   * The policy is only prefilled when there is exactly one active policy —
   * with two, picking either would be a guess, and a ticket filed against the
   * wrong policy is worse than one filed against none.
   */
  const ticketPrefill = useMemo<CreateTicketPrefill | undefined>(() => {
    if (!household || isDemo) return undefined;

    const activePolicies = household.policies.filter((p) => p.active);
    const onlyPolicy = activePolicies.length === 1 ? activePolicies[0] : null;

    return {
      householdId: household.id,
      householdLabel:
        household.name ?? household.primaryContactName ?? "This household",
      policyId: onlyPolicy?.id ?? null,
      policyLabel: onlyPolicy
        ? [onlyPolicy.policyNumber ?? "No number", onlyPolicy.policyType]
            .filter(Boolean)
            .join(" · ")
        : undefined,
      assignedUserId: household.assignedCrmId,
    };
  }, [household, isDemo]);

  return (
    <AppShell>
      {!household && (
        <header className="flex items-center gap-2 border-b border-border px-4 py-4 md:px-6">
          <MobileNav className="-ml-1" />
          <h1 className="text-lg font-semibold tracking-tight">Household</h1>
        </header>
      )}

      {!isDemo && query.isPending && (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-5 animate-spin" />
          Loading household…
        </div>
      )}

      {!isDemo && query.isError && (
        <div className="m-4 space-y-3 rounded-xl border border-border bg-card p-6 md:m-6">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle aria-hidden className="size-5" />
            Household not found.
          </p>
          <p className="text-sm text-muted-foreground">
            It may have been removed, or it is outside your branch.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      )}

      {household && (
        // `h-screen`, matching `TicketWorkspacePage`: `AppShell` is
        // `min-h-screen`, so it grows with its content rather than pinning the
        // viewport. The three columns scroll independently above `xl`, which
        // needs a definite height to measure against — `h-full` would collapse
        // to auto and every column would grow the page instead.
        <div className="flex h-screen min-h-0 flex-1 flex-col overflow-hidden">
          <HouseholdHeader
            householdName={household.name ?? "Unnamed household"}
            recordLabel={`HH-${household.id.slice(-6).toUpperCase()}`}
            // The demo household is not a real record, so there is nothing to
            // write against — both buttons stay inert there.
            onNewTicket={isDemo ? undefined : () => setCreateTicketOpen(true)}
            onAddMember={isDemo ? undefined : () => setAddMemberOpen(true)}
            onStartQuote={
              startQuoteDisabledReason ? undefined : () => setStartQuoteOpen(true)
            }
            disabledReasons={{
              addMember: demoReason,
              newTicket: demoReason,
              startQuote: startQuoteDisabledReason,
            }}
          />

          {/* Three columns above `xl`, one scrolling column below it.
              Each column is its own scroll container: `min-h-0` on the row and
              on every column is what lets them scroll independently instead of
              growing the page — without it a flex child's min-height is its
              content, so the tallest column silently sets the row's height.

              Every column is `shrink-0` below `xl`, where the row is the single
              scroller: the row has a definite height there, so a column left
              shrinkable would be squeezed by its siblings rather than pushed
              below the fold — with `min-h-0` on it, all the way to zero. The
              middle column only becomes the flexible one at `xl`, where the
              columns are side by side and there is width to distribute. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
            {/* Left — Household profile (25%) */}
            <div className="flex min-h-0 shrink-0 flex-col border-b border-border xl:w-1/4 xl:min-w-[260px] xl:max-w-[320px] xl:overflow-hidden xl:border-b-0 xl:border-r">
              <HouseholdProfile household={household} isDemo={isDemo} />
            </div>

            {/* Middle — Policy portfolio (50%) */}
            <div className="flex min-h-0 shrink-0 flex-col border-b border-border xl:flex-1 xl:shrink xl:overflow-hidden xl:border-b-0 xl:border-r">
              <PolicyPortfolio policies={household.policies} isDemo={isDemo} />
            </div>

            {/* Right — Onboarding + activity feed (25%) */}
            <div className="flex min-h-0 shrink-0 flex-col xl:w-1/4 xl:min-w-[260px] xl:max-w-[340px] xl:overflow-hidden">
              {/* Onboarding is tracked per client, so its progress belongs on
                  the client — and it is the only place a scheduled call is
                  visible before it opens in the ticket queue.

                  Capped and scrollable in its own right on the three-column
                  layout: a client with several onboardings would otherwise push
                  the ticket feed off the bottom. It renders nothing when there
                  are none, and an empty box has no height, so no gap appears
                  above the feed. */}
              <div className="shrink-0 xl:max-h-[40%] xl:overflow-y-auto">
                <HouseholdOnboarding
                  householdId={isDemo ? undefined : household.id}
                />
              </div>
              {/* `min-h-[24rem]` on the stacked layout: the feed is the last
                  thing on the page there and has no parent height to fill. */}
              <div className="min-h-[24rem] flex-1 xl:min-h-0">
                <ActivityFeed
                  householdId={isDemo ? undefined : household.id}
                  isDemo={isDemo}
                />
              </div>
            </div>
          </div>

          {/* Mounted only for a live record the caller may quote: the demo
              household is not a real record, so there is nothing to attach a
              lead or a recap to. `household` is a `HouseholdView` here — the
              dialog prefills the New Lead form from it. */}
          {!isDemo && canStartQuote && (
            <StartQuoteDialog
              household={household}
              open={startQuoteOpen}
              onOpenChange={setStartQuoteOpen}
            />
          )}

          <AddMemberDialog
            householdId={household.id}
            householdName={household.name ?? "this household"}
            open={addMemberOpen}
            onOpenChange={setAddMemberOpen}
          />

          {/* Stays on the household rather than jumping to the workspace: the
              new ticket appears at the top of the feed on the right, which is
              the confirmation, and the CSR is usually still reading the client. */}
          <CreateTicketDialog
            open={createTicketOpen}
            onOpenChange={setCreateTicketOpen}
            prefill={ticketPrefill}
            // Opened from a client, the ticket is for that client: the policy
            // picker offers only this household's policies rather than the
            // whole agency's book.
            restrictPolicyToHousehold
            onCreated={() => {
              queryClient.invalidateQueries({
                queryKey: ["household-tickets", household.id],
              });
              // An Onboarding ticket creates the whole chain, not just itself.
              queryClient.invalidateQueries({
                queryKey: ["household-onboardings", household.id],
              });
            }}
          />
        </div>
      )}
    </AppShell>
  );
}
