import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KpiStrip } from "./components/KpiStrip";
import { TicketFeed } from "./components/TicketFeed";
import { WorkspacePanel } from "./components/WorkspacePanel";
import type { TicketStatus } from "./components/ticket-data";
import {
  addServiceTicketNote,
  listServiceTickets,
  updateServiceTicketStatus,
  type ServiceTicketNoteType,
} from "@/lib/service-tickets-api";

const TICKETS_KEY = ["service-tickets"];

export default function App() {
  const queryClient = useQueryClient();
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
    <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-background font-sans">
      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Page header */}
        <div className="bg-card border-b border-border px-5 py-2.5 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Service Tickets</h2>
            <p className="text-xs text-muted-foreground">
              {ticketsQuery.isLoading
                ? "Loading tickets…"
                : `${tickets.length} ticket${tickets.length !== 1 ? "s" : ""} in your queue`}
            </p>
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
                  isMutating={statusMutation.isPending || noteMutation.isPending}
                  onChangeStatus={(id, status) =>
                    statusMutation.mutate({ id, status })
                  }
                  onAddNote={(id, content, type) =>
                    noteMutation.mutate({ id, content, type })
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
