import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { KpiStrip } from "./components/KpiStrip";
import { TicketFeed } from "./components/TicketFeed";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { TICKETS } from "./components/ticket-data";

export default function App() {
  /* MARKER-MAKE-KIT-INVOKED */
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(TICKETS[0].id);
  const [activeNav, setActiveNav] = useState("tickets");

  const selectedTicket = TICKETS.find((t) => t.id === selectedTicketId) ?? null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background font-sans">
      {/* Sidebar */}
      <Sidebar activeSection={activeNav} onNav={setActiveNav} />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Page header */}
        <div className="bg-white border-b border-border px-5 py-2.5 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Service Tickets</h2>
            <p className="text-xs text-muted-foreground">Jun 9, 2026 — Real-time view</p>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--kpi-blue)] text-white hover:opacity-90 transition-opacity">
            + New Ticket
          </button>
        </div>

        {/* KPI Strip */}
        <KpiStrip tickets={TICKETS} />

        {/* 40/60 Split workspace */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: Ticket Feed (40%) */}
          <div className="w-[40%] shrink-0 min-h-0 overflow-hidden">
            <TicketFeed
              tickets={TICKETS}
              selectedId={selectedTicketId}
              onSelect={setSelectedTicketId}
            />
          </div>

          {/* Right: Workspace Panel (60%) */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <WorkspacePanel ticket={selectedTicket} />
          </div>
        </div>
      </div>
    </div>
  );
}
