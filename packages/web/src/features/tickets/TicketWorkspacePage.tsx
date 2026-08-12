import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { KpiStrip } from "./components/KpiStrip";
import { TicketFeed } from "./components/TicketFeed";
import { WorkspacePanel } from "./components/WorkspacePanel";
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

export default function App() {
  const queryClient = useQueryClient();
  const { canWrite } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: TICKETS_KEY,
    queryFn: () => listServiceTickets(),
  });

  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);

  // Preselect from ?ticket=<id> (deep link from the Service Dashboard "Open"),
  // otherwise fall back to the first ticket in the list.
  useEffect(() => {
    if (!tickets.length) return;
    const requested = searchParams.get("ticket");
    if (requested && tickets.some((t) => t.id === requested)) {
      setSelectedTicketId(requested);
      return;
    }
    setSelectedTicketId((current) =>
      current && tickets.some((t) => t.id === current)
        ? current
        : tickets[0].id,
    );
  }, [tickets, searchParams]);

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
    <AppShell>
      <div className="flex-1 flex flex-col min-w-0 h-screen min-h-0 overflow-hidden bg-background font-sans">
      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Page header */}
        <div className="bg-card border-b border-border px-5 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <MobileNav className="-ml-1" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">Service Tickets</h2>
              <p className="text-xs text-muted-foreground">
                {ticketsQuery.isLoading
                  ? "Loading tickets…"
                  : `${tickets.length} ticket${tickets.length !== 1 ? "s" : ""} in your queue`}
              </p>
            </div>
          </div>
        </div>

        {ticketsQuery.isError ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Failed to load tickets. Please retry.
          </div>
        ) : (
          <>
            {/* KPI Strip */}
            <KpiStrip tickets={tickets} />

            {/* 40/60 Split workspace */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Left: Ticket Feed (40%) */}
              <div className="w-[40%] shrink-0 min-h-0 overflow-hidden">
                <TicketFeed
                  tickets={tickets}
                  selectedId={selectedTicketId}
                  onSelect={handleSelect}
                />
              </div>

              {/* Right: Workspace Panel (60%) */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <WorkspacePanel
                  ticket={selectedTicket}
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
      </div>
    </AppShell>
  );
}
