import { useState } from "react";
import { Header } from "./components/Header";
import { ScoreCards } from "./components/ScoreCards";
import { DealsAuditBoard } from "./components/DealsAuditBoard";
import { HotLeadsPanel } from "./components/HotLeadsPanel";

export default function ProducerDashboardPage() {
  const [activeFilter, setActiveFilter] = useState("This Month");

  return (
    // Navigation now lives in the shared AppLayout/AppSidebar shell; this page
    // only renders its own content column (header + workspace).
    <div
      className="flex-1 flex flex-col min-w-0 overflow-x-hidden"
      style={{
        background: "#0B0F19",
        color: "#E2E8F0",
        fontFamily: "'Inter', 'system-ui', sans-serif",
        minHeight: "100vh",
      }}
    >
      <Header activeFilter={activeFilter} onFilterChange={setActiveFilter} />

      <div className="flex-1 overflow-y-auto">
        {/* Scorecards */}
        <ScoreCards filter={activeFilter} />

        {/* Workspace 60/40 split.
            Page-level permission rule: access is all-or-nothing per page.
            Reaching this route already requires `dashboard:read`, so every
            panel the dashboard shows is part of the dashboard page and is
            visible to anyone with `dashboard:read`. */}
        <div className="grid gap-4 px-6 pb-6" style={{ gridTemplateColumns: "3fr 2fr" }}>
          <DealsAuditBoard />
          <HotLeadsPanel />
        </div>
      </div>
    </div>
  );
}
