import { QuickActionBar } from "./components/QuickActionBar";
import { HouseholdProfile } from "./components/HouseholdProfile";
import { PolicyPortfolio } from "./components/PolicyPortfolio";
import { ActivityFeed } from "./components/ActivityFeed";

export default function App() {
  return (
    <div
      className="flex flex-col"
      style={{
        height: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        overflow: "hidden",
      }}
    >
      {/* Top Nav Bar */}
      <div
        className="flex items-center justify-between px-6 py-2.5 shrink-0 border-b"
        style={{ background: "#060c18", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: "#1d4ed8" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.9" />
                <rect x="8" y="1" width="5" height="5" rx="1" fill="white" fillOpacity="0.5" />
                <rect x="1" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.5" />
                <rect x="8" y="8" width="5" height="5" rx="1" fill="white" fillOpacity="0.9" />
              </svg>
            </div>
            <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>AgencyOS</span>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "#1d4ed820", color: "#3b82f6", border: "1px solid #1d4ed840" }}>
              Producer
            </span>
          </div>

          <div className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />

          {["Dashboard", "Households", "Policies", "Claims", "Reports"].map((item, i) => (
            <button
              key={item}
              className="text-xs px-2 py-1 rounded transition-colors hover:bg-white/5"
              style={{ color: i === 1 ? "#3b82f6" : "var(--muted-foreground)" }}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="w-px h-4" style={{ background: "var(--border)" }} />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold" style={{ background: "#1e3a5f", color: "#3b82f6", border: "1px solid #3b82f640" }}>
              MT
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-medium" style={{ color: "var(--foreground)" }}>M. Torres</p>
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Producer · ATL-07</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="shrink-0">
        <QuickActionBar householdName="The Cobb Household" />
      </div>

      {/* 3-Column Layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left Column — Household Profile (25%) */}
        <div
          className="flex flex-col border-r shrink-0"
          style={{
            width: "25%",
            minWidth: "260px",
            maxWidth: "320px",
            borderColor: "var(--border)",
            overflow: "hidden",
          }}
        >
          <HouseholdProfile />
        </div>

        {/* Middle Column — Policy Portfolio (50%) */}
        <div
          className="flex flex-col flex-1 border-r"
          style={{ borderColor: "var(--border)", overflow: "hidden" }}
        >
          <PolicyPortfolio />
        </div>

        {/* Right Column — Activity Feed (25%) */}
        <div
          className="flex flex-col shrink-0"
          style={{
            width: "25%",
            minWidth: "260px",
            maxWidth: "340px",
            overflow: "hidden",
          }}
        >
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
