import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Archive } from "lucide-react";
import { SERVICE_TICKET_ARCHIVE_AFTER_DAYS } from "@sfa/shared";
import { TicketFeed } from "./components/TicketFeed";
import { WorkspacePanel } from "./components/WorkspacePanel";
import type { TicketStatus } from "./components/ticket-data";
import {
  addServiceTicketNote,
  listServiceTickets,
  updateServiceTicketStatus,
  type ServiceTicketNoteType,
} from "@/lib/service-tickets-api";

const ARCHIVED_KEY = ["service-tickets", "archived"];

/**
 * Archived Tickets — tickets that were resolved more than
 * `SERVICE_TICKET_ARCHIVE_AFTER_DAYS` ago and have therefore aged out of the
 * active queue. Reopening one (via the status picker) pulls it straight back
 * into the working ticket list.
 */
export default function ArchivedTicketsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ARCHIVED_KEY,
    queryFn: () => listServiceTickets({ archived: true }),
  });

  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);

  useEffect(() => {
    if (!tickets.length) {
      setSelectedTicketId(null);
      return;
    }
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

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["service-tickets"] });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TicketStatus }) =>
      updateServiceTicketStatus(id, status),
    onSuccess: invalidate,
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
    onSuccess: invalidate,
  });

  const handleSelect = (id: string) => {
    setSelectedTicketId(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("ticket", id);
        return next;
      },
      { replace: true },
    );
  };

  return (
    // Fills the shell's content column rather than asserting 100vh inside it,
    // matching TicketWorkspacePage — same two-column split, same scrolling.
    <div className="flex-1 flex flex-col min-w-0 h-full min-h-0 overflow-hidden bg-background font-sans">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Page header */}
        <div className="bg-card border-b border-border px-5 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Link
              to="/crm/service"
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Service Dashboard
            </Link>
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Archive className="w-3.5 h-3.5 text-muted-foreground" />
                Archived Tickets
              </h2>
              <p className="text-xs text-muted-foreground">
                {ticketsQuery.isLoading
                  ? "Loading archived tickets…"
                  : `${tickets.length} ticket${tickets.length !== 1 ? "s" : ""} resolved more than ${SERVICE_TICKET_ARCHIVE_AFTER_DAYS} days ago`}
              </p>
            </div>
          </div>
        </div>

        {ticketsQuery.isError ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Failed to load archived tickets. Please retry.
          </div>
        ) : (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="w-[40%] shrink-0 min-h-0 overflow-hidden">
              <TicketFeed
                tickets={tickets}
                selectedId={selectedTicketId}
                onSelect={handleSelect}
                showStatusTabs={false}
                emptyLabel={`Nothing archived yet. Tickets land here ${SERVICE_TICKET_ARCHIVE_AFTER_DAYS} days after they are resolved.`}
              />
            </div>

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
        )}
      </div>
    </div>
  );
}
