import { AppShell } from "@/components/layout/AppShell";
import { Header } from "./components/Header";
import { ScoreCards } from "./components/ScoreCards";
import { DealsAuditBoard } from "./components/DealsAuditBoard";
import { HotLeadsPanel } from "./components/HotLeadsPanel";
import { useDashboardRange } from "./useDashboardRange";

export default function ProducerDashboardPage() {
  const { range, setRange } = useDashboardRange();

  return (
    <AppShell>
      <Header range={range} onRangeChange={setRange} />

      <div className="flex-1">
        {/* Scorecards */}
        <ScoreCards range={range} />

        {/* Workspace 60/40 split, stacked below `xl`. `xl` rather than `lg`
            because the hand-off board needs ~500px before its four columns
            read; at 1024px, three fifths of what is left beside the sidebar is
            not that.
            The row floor keeps the contact list readable when the hand-off
            board is short or empty — the board sizes the row, and the contact
            list fills it rather than collapsing with it.
            Page-level permission rule: access is all-or-nothing per page.
            Reaching this route already requires `dashboard:read`, so every
            panel the dashboard shows is part of the dashboard page and is
            visible to anyone with `dashboard:read`. */}
        <div className="grid grid-cols-1 gap-4 px-4 pb-6 md:px-6 xl:min-h-[420px] xl:grid-cols-[3fr_2fr]">
          <DealsAuditBoard />
          <HotLeadsPanel />
        </div>
      </div>
    </AppShell>
  );
}
