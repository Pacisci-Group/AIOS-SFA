import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getHousehold } from "@/lib/households-api";
import {
  CreateTicketDialog,
  type CreateTicketPrefill,
} from "@/features/service/components/CreateTicketDialog";
import { DEMO_HOUSEHOLD } from "./demo-household";
import { AddMemberDialog } from "./components/AddMemberDialog";
import { QuickActionBar } from "./components/QuickActionBar";
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
 * The page renders inside the app shell, so it has no top nav of its own.
 */
export default function HouseholdDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const isDemo = !id || id === "demo";
  const queryClient = useQueryClient();
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);

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
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {!isDemo && query.isPending && (
        <div className="px-6 py-4 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Loading household…
        </div>
      )}

      {!isDemo && query.isError && (
        <div className="px-6 py-4">
          <p className="text-sm text-red-400">Household not found.</p>
          <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            It may have been removed, or it is outside your branch.
          </p>
        </div>
      )}

      {household && (
        <>
          {/* Quick Action Bar */}
          <div className="shrink-0">
            <QuickActionBar
              householdName={household.name ?? "Unnamed household"}
              // The demo household is not a real record, so there is nothing to
              // write against — both buttons stay inert there.
              onNewTicket={
                isDemo ? undefined : () => setCreateTicketOpen(true)
              }
              onAddMember={isDemo ? undefined : () => setAddMemberOpen(true)}
            />
          </div>

          {/* 3-Column Layout.
              Each column is its own scroll container: `min-h-0` on the row and
              on every column is what lets them scroll independently instead of
              growing the page — without it a flex child's min-height is its
              content, so the tallest column silently sets the row's height. */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left Column — Household Profile (25%) */}
            <div
              className="flex flex-col shrink-0 min-h-0 overflow-hidden border-r"
              style={{
                width: "25%",
                minWidth: "260px",
                maxWidth: "320px",
                borderColor: "var(--border)",
              }}
            >
              <HouseholdProfile household={household} isDemo={isDemo} />
            </div>

            {/* Middle Column — Policy Portfolio (50%) */}
            <div
              className="flex flex-1 flex-col min-h-0 overflow-hidden border-r"
              style={{ borderColor: "var(--border)" }}
            >
              <PolicyPortfolio policies={household.policies} isDemo={isDemo} />
            </div>

            {/* Right Column — Onboarding + Activity Feed (25%) */}
            <div
              className="flex flex-col shrink-0 min-h-0 overflow-hidden"
              style={{ width: "25%", minWidth: "260px", maxWidth: "340px" }}
            >
              {/* Onboarding is tracked per client, so its progress belongs on
                  the client — and it is the only place a scheduled call is
                  visible before it opens in the ticket queue.

                  Capped and scrollable in its own right: a client with several
                  onboardings would otherwise push the ticket feed off the
                  bottom. It renders nothing when there are none, and an empty
                  box has no height, so no gap appears above the feed. */}
              <div className="shrink-0 max-h-[40%] overflow-y-auto">
                <HouseholdOnboarding householdId={isDemo ? undefined : household.id} />
              </div>
              <div className="flex-1 min-h-0">
                <ActivityFeed
                  householdId={isDemo ? undefined : household.id}
                  isDemo={isDemo}
                />
              </div>
            </div>
          </div>

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
        </>
      )}
    </div>
  );
}
