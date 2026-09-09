import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronRight } from "lucide-react";
import { ModuleKey, SERVICE_TICKET_ARCHIVE_AFTER_DAYS } from "@sfa/shared";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
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
  const { canWrite } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  /**
   * Which of the two stacked panes is showing below `lg`. Ignored above it.
   * A `?ticket=` deep link opens straight onto that ticket — see the longer
   * note on `TicketWorkspacePage`.
   */
  const [mobilePane, setMobilePane] = useState<"queue" | "workspace">(() =>
    searchParams.get("ticket") ? "workspace" : "queue",
  );

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
    setMobilePane("workspace");
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
    // Asserts the viewport height itself, matching TicketWorkspacePage — same
    // two-column split, same internal scrolling, and `AppShell` is
    // `min-h-screen` rather than a pinned parent to measure against.
    <AppShell>
      <div className="flex h-screen min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-4 md:gap-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 md:gap-3">
            <MobileNav className="-ml-1" />
            <nav
              aria-label="Breadcrumb"
              className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex"
            >
              <Link
                to="/crm/service"
                className="transition-colors hover:text-foreground"
              >
                Service
              </Link>
              <ChevronRight aria-hidden className="size-4" />
            </nav>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">
                Archived tickets
              </h1>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {ticketsQuery.isLoading || ticketsQuery.isError
                  ? " "
                  : `${tickets.length} resolved over ${SERVICE_TICKET_ARCHIVE_AFTER_DAYS} days ago`}
              </p>
            </div>
          </div>
        </header>

        {ticketsQuery.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Couldn't load archived tickets.
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
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div
              className={cn(
                "min-h-0 w-full shrink-0 overflow-hidden lg:block lg:w-[40%]",
                mobilePane === "workspace" && "hidden",
              )}
            >
              <TicketFeed
                tickets={tickets}
                selectedId={selectedTicketId}
                onSelect={handleSelect}
                showStatusTabs={false}
                emptyLabel={`Nothing archived yet. Tickets land here ${SERVICE_TICKET_ARCHIVE_AFTER_DAYS} days after they are resolved.`}
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
                // Reopening an archived ticket happens through the status
                // picker, so this page has to pass the same gate the live
                // workspace does — without it the picker renders read-only and
                // there is no way back out of the archive.
                canWrite={canWrite(ModuleKey.CrmService)}
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
    </AppShell>
  );
}
