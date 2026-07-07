import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { ScoreCards } from "./components/ScoreCards";
import { DealsAuditBoard } from "./components/DealsAuditBoard";
import { HotLeadsPanel } from "./components/HotLeadsPanel";

export default function App() {
  const [activeFilter, setActiveFilter] = useState("This Month");

  return (
    <div
      className="flex min-h-screen w-full"
      style={{ background: "#0B0F19", color: "#E2E8F0", fontFamily: "'Inter', 'system-ui', sans-serif" }}
    >
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <Header activeFilter={activeFilter} onFilterChange={setActiveFilter} />

        <div className="flex-1 overflow-y-auto">
          {/* Scorecards */}
          <ScoreCards filter={activeFilter} />

          {/* Workspace 60/40 split */}
          <div className="grid gap-4 px-6 pb-6" style={{ gridTemplateColumns: "3fr 2fr" }}>
            <DealsAuditBoard />
            <HotLeadsPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
