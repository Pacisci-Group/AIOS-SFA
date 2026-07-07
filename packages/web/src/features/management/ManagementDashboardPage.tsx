import { useState } from "react";
import { Shield, Crown, Users, Bell, Settings, ChevronDown, Building2 } from "lucide-react";
import { GlobalFilterBar } from "./components/GlobalFilterBar";
import { OwnerDashboard } from "./components/OwnerDashboard";
import { ManagerDashboard } from "./components/ManagerDashboard";

{/* MARKER-MAKE-KIT-INVOKED */}
{/* MARKER-MAKE-KIT-DISCOVERY-READ */}

type FilterState = {
  producer: string;
  leadSource: string;
  lineOfBusiness: string;
  dateRange: string;
};

const DEFAULT_FILTERS: FilterState = {
  producer: "All Producers",
  leadSource: "All Sources",
  lineOfBusiness: "All Lines",
  dateRange: "This Month",
};

export default function App() {
  const [view, setView] = useState<"owner" | "manager">("owner");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* ── Top Header ── */}
      <header
        style={{
          background: "var(--card)",
          borderBottom: "1px solid var(--border)",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          height: "56px",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #10b981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Shield size={15} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 800, color: "var(--foreground)", letterSpacing: "-0.01em" }}>
              Greenfield Insurance
            </div>
            <div style={{ fontSize: "10px", color: "var(--muted-foreground)", fontWeight: 500, letterSpacing: "0.04em" }}>
              EXECUTIVE DASHBOARD
            </div>
          </div>
        </div>

        <div style={{ width: "1px", height: "24px", background: "var(--border)", margin: "0 4px" }} />

        {/* View Toggle */}
        <div
          style={{
            display: "flex",
            background: "var(--secondary)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "3px",
            gap: "2px",
          }}
        >
          {[
            { id: "owner" as const, label: "Owner View", icon: <Crown size={12} /> },
            { id: "manager" as const, label: "Manager View", icon: <Users size={12} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 12px",
                borderRadius: "6px",
                border: "none",
                background: view === tab.id ? "var(--emerald)" : "transparent",
                color: view === tab.id ? "#fff" : "var(--muted-foreground)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px" }}>
          {/* Agency selector */}
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 10px",
              background: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--foreground)",
              fontSize: "12px",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
            }}
          >
            <Building2 size={12} style={{ color: "var(--muted-foreground)" }} />
            All Offices
            <ChevronDown size={11} style={{ color: "var(--muted-foreground)" }} />
          </button>

          {/* Notification bell */}
          <div style={{ position: "relative" }}>
            <button
              style={{
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--secondary)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                cursor: "pointer",
                color: "var(--muted-foreground)",
              }}
            >
              <Bell size={14} />
            </button>
            <div
              style={{
                position: "absolute",
                top: "5px",
                right: "5px",
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: "var(--red)",
                border: "1px solid var(--card)",
              }}
            />
          </div>

          <button
            style={{
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
              color: "var(--muted-foreground)",
            }}
          >
            <Settings size={14} />
          </button>

          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #10b981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: 700,
              color: "#fff",
              cursor: "pointer",
              marginLeft: "2px",
            }}
          >
            JM
          </div>
        </div>
      </header>

      {/* ── View Title Bar ── */}
      <div
        style={{
          background: "var(--card)",
          borderBottom: "1px solid var(--border)",
          padding: "10px 24px 0",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              {view === "owner" ? (
                <Crown size={14} style={{ color: "var(--emerald)" }} />
              ) : (
                <Users size={14} style={{ color: "var(--emerald)" }} />
              )}
              <h1 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--foreground)" }}>
                {view === "owner" ? "Strategy Hub — Owner Dashboard" : "Action Hub — Manager Dashboard"}
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "8px" }}>
              {view === "owner"
                ? "Agency-wide health, premium trajectory, and business mix for executive decision-making."
                : "Real-time team operations, pipeline friction points, and producer coaching interface."}
            </p>
          </div>
        </div>

        {/* Tab underline indicator */}
        <div style={{ display: "flex", gap: "0" }}>
          {["owner", "manager"].map((v) => (
            <div
              key={v}
              onClick={() => setView(v as "owner" | "manager")}
              style={{
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                color: view === v ? "var(--emerald)" : "var(--muted-foreground)",
                borderBottom: view === v ? "2px solid var(--emerald)" : "2px solid transparent",
                marginBottom: "-1px",
                cursor: "pointer",
                transition: "all 0.15s",
                textTransform: "capitalize",
                userSelect: "none",
              }}
            >
              {v === "owner" ? "👑 Owner" : "📋 Manager"}
            </div>
          ))}
        </div>
      </div>

      {/* ── Global Filter Bar ── */}
      <GlobalFilterBar filters={filters} onChange={setFilters} />

      {/* ── Main Canvas ── */}
      <main
        style={{
          flex: 1,
          padding: "20px 24px",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {view === "owner" ? <OwnerDashboard /> : <ManagerDashboard />}
      </main>

      {/* ── Status Bar ── */}
      <footer
        style={{
          background: "var(--navy-900, #0f172a)",
          borderTop: "1px solid var(--border)",
          padding: "5px 24px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--emerald)" }} />
          <span style={{ fontSize: "10px", color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
            Live · Last synced: {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div style={{ width: "1px", height: "10px", background: "var(--border)" }} />
        <span style={{ fontSize: "10px", color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
          Greenfield Insurance Agency · {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <div style={{ marginLeft: "auto", fontSize: "10px", color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
          v2.4.1
        </div>
      </footer>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>
    </div>
  );
}
