import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Search, ChevronDown, Archive, Plus } from "lucide-react";
import { CreateTicketDialog } from "./components/CreateTicketDialog";
import { ScorecardRow } from "./components/ScorecardRow";
import { PriorityTicketQueue } from "./components/PriorityTicketQueue";
import { RenewalOutreachDesk } from "./components/RenewalOutreachDesk";
import {
  addServiceTicketNote,
  getServiceTicketStats,
  listServiceTickets,
  updateServiceTicketStatus,
  type ServiceTicketStats,
  type ServiceTicketStatus,
} from "@/lib/service-tickets-api";

const FALLBACK_STATS: ServiceTicketStats = {
  openTickets: 0,
  needsActionToday: 0,
  upcomingRenewals: 0,
  premiumIncreases: 0,
  resolvedToday: 0,
  dailyTarget: 10,
  totalHouseholds: 0,
  avgLobDensity: 0,
};

export default function App() {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const ticketsQuery = useQuery({
    queryKey: ["service-tickets"],
    queryFn: () => listServiceTickets(),
  });
  const statsQuery = useQuery({
    queryKey: ["service-tickets", "stats"],
    queryFn: getServiceTicketStats,
  });

  const noteMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      addServiceTicketNote(id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
      // Resolving a renewal ticket from the queue takes its row off the desk.
      queryClient.invalidateQueries({ queryKey: ["renewal-desk"] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ServiceTicketStatus }) =>
      updateServiceTicketStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
      // Resolving a renewal ticket from the queue takes its row off the desk.
      queryClient.invalidateQueries({ queryKey: ["renewal-desk"] });
    },
  });

  const tickets = ticketsQuery.data ?? [];
  const scorecardStats = statsQuery.data ?? FALLBACK_STATS;

  const openTicket = (id: string) => navigate(`/crm/tickets?ticket=${id}`);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-screen bg-background text-foreground overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="relative z-50 flex-shrink-0 flex items-center gap-4 px-6 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Dashboard</span>
            <ChevronDown size={13} className="text-muted-foreground -rotate-90" />
            <span className="font-semibold text-foreground">CRM Service</span>
          </div>

          <div className="flex-1 max-w-sm ml-4">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Search clients, tickets, policies..."
                className="w-full pl-8 pr-4 py-2 text-xs bg-secondary border border-white/8 rounded-lg text-foreground placeholder-muted-foreground outline-none focus:border-[#0076A8]/40 transition-colors"
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/20">
              <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
              <span className="text-[11px] font-semibold text-[#F59E0B]">2 Critical SLAs</span>
            </div>

            <div className="relative">
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <Bell size={16} />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#F59E0B] border-2 border-background" />
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-white/10 bg-card shadow-2xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                    <span className="text-sm font-semibold text-foreground">Notifications</span>
                    <span className="text-[10px] text-muted-foreground">3 unread</span>
                  </div>
                  {[
                    { title: "SLA Breach: Meredith Dunning", desc: "Renewal ticket T-4821 is now 8 days overdue", time: "2h ago", color: "#EF4444" },
                    { title: "Premium Alert: 12 renewals flagged", desc: "Premium increases >10% need review this week", time: "4h ago", color: "#F59E0B" },
                    { title: "Ticket Resolved: Angela Ferreira", desc: "Address update T-4833 successfully closed", time: "Today 9:15 AM", color: "#10B981" },
                  ].map((n, i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors border-b border-white/5 last:border-0 cursor-pointer">
                      <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: n.color }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground">{n.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{n.desc}</div>
                        <div className="text-[10px] text-muted-foreground/60 mt-1">{n.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0076A8] to-[#10B981] flex items-center justify-center text-white text-xs font-bold">
              RL
            </button>
          </div>
        </header>

        {/* Dashboard body */}
        {/* The body itself does not scroll — the header and scorecard stay put and
            the two workspace columns own their own scrollbars (see the grid below). */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden px-6 py-5 gap-5">
          <div className="flex items-center justify-between flex-shrink-0">
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Service Dashboard</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Monday, June 9 · Week 23 · Q2 Sprint 6</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0076A8] text-[11px] font-semibold text-white hover:bg-[#0076A8]/85 transition-colors"
              >
                <Plus size={13} />
                New Ticket
              </button>
              <Link
                to="/crm/tickets/archived"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-white/8 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
              >
                <Archive size={13} />
                Go To Archived Tickets
              </Link>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/20">
                <div className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                <span className="text-[11px] font-semibold text-[#10B981]">Service Rep View</span>
              </div>
            </div>
          </div>

          {/* Row 1: Scorecard */}
          <div className="flex-shrink-0">
            <ScorecardRow stats={scorecardStats} />
          </div>

          {/* Row 2: 60/40 Workspace. `min-h-0` is what lets the row take a definite
              height instead of growing to fit its content — without it the columns'
              inner `overflow-y-auto` never clips and the whole page scrolls instead.
              Both columns set `overflow-hidden`, so their grid auto-minimum is 0. */}
          <div
            className="grid gap-5 flex-1 min-h-0"
            style={{ gridTemplateColumns: "3fr 2fr" }}
          >
            <PriorityTicketQueue
              tickets={tickets}
              onOpen={openTicket}
              onAddNote={(id, content) => noteMutation.mutate({ id, content })}
              onChangeStatus={(id, status) => statusMutation.mutate({ id, status })}
            />
            <RenewalOutreachDesk onOpenTicket={openTicket} />
          </div>
        </main>
      </div>

      {notificationsOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setNotificationsOpen(false)} />
      )}

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={openTicket}
      />
    </div>
  );
}
