import { AppSidebar } from "@/components/layout/AppSidebar";
import { Header } from "./components/Header";
import { ScoreCards } from "./components/ScoreCards";
import { DealsAuditBoard } from "./components/DealsAuditBoard";
import { HotLeadsPanel } from "./components/HotLeadsPanel";
import { useDashboardRange } from "./useDashboardRange";

export default function ProducerDashboardPage() {
  const { range, setRange } = useDashboardRange();

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Hidden below md, matching LeadsPage — the sidebar is a fixed 260px
          and would otherwise squeeze the dashboard off-screen on a phone. */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <Header range={range} onRangeChange={setRange} />

        <div className="flex-1 overflow-y-auto">
          {/* Scorecards */}
          <ScoreCards range={range} />

          {/* Workspace 60/40 split.
              Page-level permission rule: access is all-or-nothing per page.
              Reaching this route already requires `dashboard:read`, so every
              panel the dashboard shows is part of the dashboard page and is
              visible to anyone with `dashboard:read`. */}
          <div
            className="grid gap-4 px-6 pb-6"
            style={{ gridTemplateColumns: "3fr 2fr" }}
          >
            <DealsAuditBoard />
            <HotLeadsPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
