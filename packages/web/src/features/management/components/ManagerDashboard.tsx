import { useState } from "react";
import { AlertTriangle, Clock, Ticket, Phone, FileText, CheckCircle2, MoreHorizontal, ChevronRight, Zap, Activity } from "lucide-react";
import { ProducerDrawer } from "./ProducerDrawer";

type Producer = {
  name: string;
  callsMade: number;
  quotesIssued: number;
  dealsClosed: number;
  pendingActions: number;
  status: "active" | "idle" | "busy";
};

const TEAM: Producer[] = [
  { name: "Sarah Mitchell", callsMade: 34, quotesIssued: 12, dealsClosed: 7, pendingActions: 2, status: "active" },
  { name: "David Chen", callsMade: 28, quotesIssued: 9, dealsClosed: 5, pendingActions: 1, status: "active" },
  { name: "Marcus Johnson", callsMade: 19, quotesIssued: 6, dealsClosed: 2, pendingActions: 3, status: "busy" },
  { name: "Ashley Rivera", callsMade: 22, quotesIssued: 8, dealsClosed: 4, pendingActions: 2, status: "active" },
  { name: "Tom Kowalski", callsMade: 8, quotesIssued: 2, dealsClosed: 1, pendingActions: 0, status: "idle" },
  { name: "Priya Patel", callsMade: 15, quotesIssued: 5, dealsClosed: 3, pendingActions: 1, status: "active" },
];

const ALERTS = [
  { label: "Stalled Leads", count: 7, detail: "No activity > 48h", icon: <Zap size={16} />, color: "var(--amber)" },
  { label: "Aging Audits", count: 4, detail: "Hand-off queue > 7d", icon: <Clock size={16} />, color: "var(--red)" },
  { label: "Overdue Tickets", count: 3, detail: "Breached SLA", icon: <Ticket size={16} />, color: "#8b5cf6" },
];

const statusDot: Record<string, string> = {
  active: "var(--emerald)",
  idle: "#64748b",
  busy: "var(--amber)",
};

function AlertBadge({ label, count, detail, icon, color }: { label: string; count: number; detail: string; icon: React.ReactNode; color: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--card)",
        border: `1px solid ${color}40`,
        borderRadius: "var(--radius)",
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: color }} />
      <div
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          background: `${color}20`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "28px", fontWeight: 800, color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
          {count}
        </div>
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--foreground)", marginTop: "2px" }}>{label}</div>
        <div style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "1px" }}>{detail}</div>
      </div>
      <div
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px ${color}`,
          animation: "pulse 2s infinite",
          flexShrink: 0,
        }}
      />
    </div>
  );
}

export function ManagerDashboard() {
  const [selectedProducer, setSelectedProducer] = useState<Producer | null>(null);

  const teamCallsTotal = TEAM.reduce((a, p) => a + p.callsMade, 0);
  const teamQuotesTotal = TEAM.reduce((a, p) => a + p.quotesIssued, 0);
  const teamClosedTotal = TEAM.reduce((a, p) => a + p.dealsClosed, 0);
  const teamPendingTotal = TEAM.reduce((a, p) => a + p.pendingActions, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Row 1: Alert Strip */}
      <div style={{ display: "flex", gap: "14px" }}>
        {ALERTS.map((a) => (
          <AlertBadge key={a.label} {...a} />
        ))}
      </div>

      {/* Row 2: Team Activity Monitor */}
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "10px" }}>
          <Activity size={15} style={{ color: "var(--emerald)" }} />
          <span style={{ fontWeight: 700, fontSize: "13px" }}>Team Activity Monitor</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              color: "var(--emerald)",
              background: "rgba(16,185,129,0.12)",
              padding: "2px 8px",
              borderRadius: "100px",
              fontWeight: 600,
            }}
          >
            <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--emerald)", display: "inline-block" }} />
            Live
          </span>
          <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--muted-foreground)" }}>
            Click any row to open producer view →
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {[
                  { label: "Producer", align: "left" },
                  { label: "Status", align: "left" },
                  { label: "Calls Today", align: "right" },
                  { label: "Quotes Issued", align: "right" },
                  { label: "Deals Closed", align: "right" },
                  { label: "Close Rate", align: "right" },
                  { label: "Pending Items", align: "right" },
                  { label: "", align: "right" },
                ].map((h) => (
                  <th
                    key={h.label}
                    style={{
                      padding: "9px 16px",
                      textAlign: h.align as "left" | "right",
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: "var(--muted-foreground)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TEAM.map((producer, i) => {
                const closeRate = producer.quotesIssued > 0
                  ? ((producer.dealsClosed / producer.quotesIssued) * 100).toFixed(0)
                  : "—";
                const isSelected = selectedProducer?.name === producer.name;

                return (
                  <tr
                    key={producer.name}
                    onClick={() => setSelectedProducer(isSelected ? null : producer)}
                    style={{
                      borderBottom: i < TEAM.length - 1 ? "1px solid var(--border)" : "none",
                      cursor: "pointer",
                      background: isSelected ? "rgba(16,185,129,0.06)" : "transparent",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            background: `hsl(${i * 51 + 140}, 55%, 22%)`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "var(--emerald)",
                            flexShrink: 0,
                            border: isSelected ? "1px solid var(--emerald)" : "1px solid transparent",
                          }}
                        >
                          {producer.name.split(" ").map((n) => n[0]).join("")}
                        </div>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--foreground)" }}>
                          {producer.name}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "3px 8px",
                          borderRadius: "100px",
                          background: `${statusDot[producer.status]}18`,
                          color: statusDot[producer.status],
                          textTransform: "capitalize",
                        }}
                      >
                        <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: statusDot[producer.status] }} />
                        {producer.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                        <Phone size={11} style={{ color: "var(--muted-foreground)" }} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 600, color: "var(--foreground)" }}>
                          {producer.callsMade}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                        <FileText size={11} style={{ color: "var(--muted-foreground)" }} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--foreground)" }}>
                          {producer.quotesIssued}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                        <CheckCircle2 size={11} style={{ color: "var(--emerald)" }} />
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 600, color: "var(--emerald)" }}>
                          {producer.dealsClosed}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "13px",
                          fontWeight: 700,
                          color: Number(closeRate) >= 60 ? "var(--emerald)" : Number(closeRate) >= 40 ? "var(--amber)" : "var(--muted-foreground)",
                        }}
                      >
                        {closeRate !== "—" ? `${closeRate}%` : closeRate}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      {producer.pendingActions > 0 ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: "22px",
                            height: "22px",
                            borderRadius: "100px",
                            padding: "0 6px",
                            background: producer.pendingActions >= 3 ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)",
                            color: producer.pendingActions >= 3 ? "var(--red)" : "var(--amber)",
                            fontSize: "11px",
                            fontWeight: 700,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {producer.pendingActions}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted-foreground)", fontSize: "12px" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <ChevronRight
                        size={14}
                        style={{
                          color: isSelected ? "var(--emerald)" : "var(--muted-foreground)",
                          transform: isSelected ? "rotate(90deg)" : "none",
                          transition: "transform 0.2s, color 0.2s",
                        }}
                      />
                    </td>
                  </tr>
                );
              })}

              {/* Totals row */}
              <tr style={{ borderTop: "1px solid var(--border)", background: "rgba(16,185,129,0.04)" }}>
                <td style={{ padding: "10px 16px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" }}>
                    Team Total
                  </span>
                </td>
                <td />
                <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--foreground)" }}>
                  {teamCallsTotal}
                </td>
                <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--foreground)" }}>
                  {teamQuotesTotal}
                </td>
                <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--emerald)" }}>
                  {teamClosedTotal}
                </td>
                <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--foreground)" }}>
                  {((teamClosedTotal / teamQuotesTotal) * 100).toFixed(0)}%
                </td>
                <td style={{ padding: "10px 16px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--amber)" }}>
                  {teamPendingTotal}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ProducerDrawer producer={selectedProducer} onClose={() => setSelectedProducer(null)} />
    </div>
  );
}
