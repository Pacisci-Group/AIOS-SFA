import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronRight } from "lucide-react";
import { ModuleKey, SERVICE_TICKET_ARCHIVE_AFTER_DAYS } from "@sfa/shared";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { TablePagination } from "@/components/common/TablePagination";
import { TicketFeed } from "./components/TicketFeed";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { useTicketQueue } from "./useTicketQueue";
import { useSelectedTicket } from "./useSelectedTicket";
import type { TicketQueueTab } from "@/lib/ticket-queue";
import type { TicketStatus } from "./components/ticket-data";
import {
  addServiceTicketNote,
  updateServiceTicketStatus,
  type ServiceTicketNoteType,
} from "@/lib/service-tickets-api";

/**
 * No status strip here: every ticket on this page is resolved or closed, so
 * four tabs of which one matches is noise. Frozen at module scope — the queue
 * hook guards the URL against this list. Search, category and sort still work.
 */
const NO_STATUS_TABS: readonly TicketQueueTab[] = [];

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

  /**
   * Paged by the server since PAC-98 — this list used to fetch every ticket in
   * the caller's scope in one response. Same URL-held filters as the live
   * workspace, on the other side of the archive window.
   */
  const queue = useTicketQueue({ archived: true, tabs: NO_STATUS_TABS });
  const tickets = queue.rows;

  // Same rule as the live workspace: a `?ticket=` deep link wins, otherwise
  // open the first row the list actually shows.
  const requestedId = searchParams.get("ticket");
  useEffect(() => {
    if (requestedId) {
      setSelectedTicketId(requestedId);
      return;
    }
    if (!tickets.length) {
      setSelectedTicketId(null);
      return;
    }
    setSelectedTicketId((current) =>
      current && tickets.some((t) => t.id === current)
        ? current
        : tickets[0].id,
    );
  }, [tickets, requestedId]);

  const selectedTicket = useSelectedTicket(selectedTicketId, tickets);

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
    // `min-h-screen` rather than a pinned parent to measure against. No
    // `flex-1`, for the reason written up there: its `flex-basis: 0%` would
    // override `h-screen` and let the page grow to the full list.
    <AppShell>
      <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-background">
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
                {queue.isLoading || queue.isError
                  ? " "
                  : `${queue.page?.total ?? 0} resolved over ${SERVICE_TICKET_ARCHIVE_AFTER_DAYS} days ago`}
              </p>
            </div>
          </div>
        </header>

        {queue.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Couldn't load archived tickets.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={queue.refetch}
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
                queue={queue}
                selectedId={selectedTicketId}
                onSelect={handleSelect}
                emptyLabel={`Nothing archived yet. Tickets land here ${SERVICE_TICKET_ARCHIVE_AFTER_DAYS} days after they are resolved.`}
              />
              <TablePagination
                page={queue.page?.page ?? queue.requestedPage}
                pageSize={queue.page?.pageSize ?? queue.pageSize}
                total={queue.page?.total ?? 0}
                totalPages={queue.page?.totalPages ?? 1}
                onPageChange={queue.setPage}
                busy={queue.isFetching}
                noun="tickets"
                className="border-t border-border px-4 py-3"
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
