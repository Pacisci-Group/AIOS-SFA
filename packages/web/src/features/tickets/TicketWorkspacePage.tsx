import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Archive } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KpiStrip } from "./components/KpiStrip";
import { TicketFeed } from "./components/TicketFeed";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { useTicketQueue } from "./useTicketQueue";
import type { TicketStatus } from "./components/ticket-data";
import {
  addServiceTicketNote,
  completeOnboardingStep,
  completeRenewalStep,
  listServiceTickets,
  setRenewalOutcome,
  updateOnboardingChecklist,
  updateRenewalPolicy,
  updateServiceTicketStatus,
  type OnboardingChecklistKey,
  type OnboardingStepKey,
  type RenewalOutcome,
  type RenewalStepKey,
  type ServiceTicketNoteType,
} from "@/lib/service-tickets-api";
import { ModuleKey } from "@sfa/shared";
import { usePermissions } from "@/hooks/usePermissions";

const TICKETS_KEY = ["service-tickets"];
/** Prefixes — the panel and the household page key by id beneath these. */
const ONBOARDING_KEY = ["onboarding"];
const HOUSEHOLD_ONBOARDINGS_KEY = ["household-onboardings"];
const RENEWAL_CYCLE_KEY = ["renewal-cycle"];
const RENEWAL_DESK_KEY = ["renewal-desk"];

/**
 * `/crm/tickets` — the CSR's queue on the left, the selected ticket's workspace
 * on the right.
 *
 * Below `lg` the two panes stack into one: the queue is the whole page until a
 * ticket is picked, then the workspace takes over with a back button in its
 * header. The fixed 40/60 split this used to have never collapsed, so on a
 * handset the queue rows were ~140px wide and the workspace ~200px.
 */
export default function TicketWorkspacePage() {
  const queryClient = useQueryClient();
  const { canWrite } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  /**
   * Which of the two stacked panes is showing below `lg`. Ignored above it.
   *
   * A `?ticket=` deep link (from the Service Dashboard, the household activity
   * feed, or an onboarding chain row) opens straight onto that ticket —
   * otherwise following one on a phone would land on the queue with no
   * indication of which row was meant.
   */
  const [mobilePane, setMobilePane] = useState<"queue" | "workspace">(() =>
    searchParams.get("ticket") ? "workspace" : "queue",
  );

  const ticketsQuery = useQuery({
    queryKey: TICKETS_KEY,
    queryFn: () => listServiceTickets(),
  });

  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);

  /**
   * The queue's filters, search and ranking — read from the URL, which is what
   * carries them here from the Service Dashboard's Priority Ticket Queue.
   */
  const queue = useTicketQueue({ tickets, selectedId: selectedTicketId });

  // Preselect from ?ticket=<id> (deep link from the Service Dashboard "Open",
  // the household activity feed, an onboarding chain row), otherwise fall back
  // to the first row of the queue as filtered — not `tickets[0]`, which is the
  // API's own order and routinely sits somewhere down the rendered list.
  const { firstMatchId } = queue;
  useEffect(() => {
    if (!tickets.length) return;
    const requested = searchParams.get("ticket");
    if (requested && tickets.some((t) => t.id === requested)) {
      setSelectedTicketId(requested);
      return;
    }
    setSelectedTicketId((current) =>
      current && tickets.some((t) => t.id === current) ? current : firstMatchId,
    );
  }, [tickets, searchParams, firstMatchId]);

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) ?? null;

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      updateServiceTicketStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
  });

  const noteMutation = useMutation({
    mutationFn: ({
      id,
      content,
      type,
    }: {
      id: string;
      content: string;
      type: ServiceTicketNoteType;
    }) => addServiceTicketNote(id, content, type),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TICKETS_KEY }),
  });

  /**
   * Onboarding writes land on the per-client `Onboarding` record as well as
   * the ticket, and the panel reads the record under its own query key. Both
   * caches must be dropped — invalidating only the ticket list leaves the
   * checklist rendering stale, which looks exactly like a dead checkbox.
   */
  const invalidateOnboarding = () => {
    void queryClient.invalidateQueries({ queryKey: TICKETS_KEY });
    void queryClient.invalidateQueries({ queryKey: ONBOARDING_KEY });
    void queryClient.invalidateQueries({ queryKey: HOUSEHOLD_ONBOARDINGS_KEY });
  };

  const onboardingStepMutation = useMutation({
    mutationFn: ({ id, stepKey }: { id: string; stepKey: OnboardingStepKey }) =>
      completeOnboardingStep(id, stepKey),
    onSuccess: invalidateOnboarding,
  });

  const onboardingChecklistMutation = useMutation({
    mutationFn: ({
      id,
      key,
      value,
    }: {
      id: string;
      key: OnboardingChecklistKey;
      value: boolean;
    }) => updateOnboardingChecklist(id, { [key]: value }),
    onSuccess: invalidateOnboarding,
  });

  /**
   * Renewal writes land on the parent `RenewalCycle` as well as the ticket, and
   * both the panel and the dashboard desk read it under their own keys — same
   * reasoning as `invalidateOnboarding` above.
   */
  const invalidateRenewal = () => {
    void queryClient.invalidateQueries({ queryKey: TICKETS_KEY });
    void queryClient.invalidateQueries({ queryKey: RENEWAL_CYCLE_KEY });
    void queryClient.invalidateQueries({ queryKey: RENEWAL_DESK_KEY });
  };

  const renewalPolicyMutation = useMutation({
    mutationFn: ({
      id,
      policyId,
      discussed,
    }: {
      id: string;
      policyId: string;
      discussed: boolean;
    }) => updateRenewalPolicy(id, policyId, discussed),
    onSuccess: invalidateRenewal,
  });

  const renewalStepMutation = useMutation({
    mutationFn: ({
      id,
      stepKey,
      outcome,
    }: {
      id: string;
      stepKey: RenewalStepKey;
      outcome?: RenewalOutcome;
    }) => completeRenewalStep(id, stepKey, outcome ? { outcome } : {}),
    onSuccess: invalidateRenewal,
  });

  const renewalOutcomeMutation = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: RenewalOutcome }) =>
      setRenewalOutcome(id, outcome),
    onSuccess: invalidateRenewal,
  });

  const handleSelect = (id: string) => {
    setSelectedTicketId(id);
    setMobilePane("workspace");
    // Keep the deep link in sync without stacking history entries.
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("ticket", id);
      return next;
    }, { replace: true });
  };

  return (
    // `h-screen`: `AppShell` is `min-h-screen`, so it grows with its content
    // rather than pinning the viewport. This page is a two-pane layout that
    // scrolls each pane internally, so it has to assert the viewport height
    // itself — `h-full` would collapse against a parent with no set height.
    //
    // **No `flex-1` here.** The shell's column is a flex container with no
    // height of its own, and `flex-1` sets `flex-basis: 0%` — which resolves
    // to *content* against an indefinite parent and takes precedence over
    // `height`. The container then sized itself to every ticket row, the item
    // grew to match, and `h-screen` never applied: the whole page scrolled and
    // neither pane did. With the basis left at `auto`, the height is the basis.
    <AppShell>
      <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-4 md:gap-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav className="-ml-1" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">
                Service tickets
              </h1>
              {/* "3 of 41" while a filter is on, rather than a queue-wide 41
                  above a list of 3 — the two disagreeing is what made the
                  workspace look like a different queue from the dashboard. */}
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {ticketsQuery.isLoading || ticketsQuery.isError
                  ? " "
                  : queue.isFiltered
                    ? `${queue.rows.length} of ${tickets.length} tickets in your queue`
                    : `${tickets.length} ticket${tickets.length !== 1 ? "s" : ""} in your queue`}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/crm/tickets/archived">
                <Archive />
                <span className="hidden sm:inline">Archived</span>
              </Link>
            </Button>
          </div>
        </header>

        {ticketsQuery.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Couldn't load tickets.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void ticketsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            <KpiStrip tickets={tickets} />

            {/* Stacked below `lg`, 40/60 above it. */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div
                className={cn(
                  "min-h-0 w-full shrink-0 overflow-hidden lg:block lg:w-[40%]",
                  mobilePane === "workspace" && "hidden",
                )}
              >
                <TicketFeed
                  queue={queue}
                  selectedId={selectedTicketId}
                  onSelect={handleSelect}
                />
              </div>

              <div
                className={cn(
                  "min-h-0 flex-1 overflow-hidden lg:block",
                  mobilePane === "queue" && "hidden",
                )}
              >
                <WorkspacePanel
                  ticket={selectedTicket}
                  onBack={() => setMobilePane("queue")}
                  isMutating={
                    statusMutation.isPending ||
                    noteMutation.isPending ||
                    onboardingStepMutation.isPending ||
                    onboardingChecklistMutation.isPending ||
                    renewalPolicyMutation.isPending ||
                    renewalStepMutation.isPending ||
                    renewalOutcomeMutation.isPending
                  }
                  canWrite={canWrite(ModuleKey.CrmService)}
                  onChangeStatus={(id, status) =>
                    statusMutation.mutate({ id, status })
                  }
                  onAddNote={(id, content, type) =>
                    noteMutation.mutate({ id, content, type })
                  }
                  onCompleteOnboardingStep={(id, stepKey) =>
                    onboardingStepMutation.mutate({ id, stepKey })
                  }
                  onToggleOnboardingChecklist={(id, key, value) =>
                    onboardingChecklistMutation.mutate({ id, key, value })
                  }
                  onToggleRenewalPolicy={(id, policyId, discussed) =>
                    renewalPolicyMutation.mutate({ id, policyId, discussed })
                  }
                  onCompleteRenewalStep={(id, stepKey, outcome) =>
                    renewalStepMutation.mutate({ id, stepKey, outcome })
                  }
                  onChangeRenewalOutcome={(id, outcome) =>
                    renewalOutcomeMutation.mutate({ id, outcome })
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
