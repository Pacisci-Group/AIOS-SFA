import { TrendingUp, TrendingDown, Home, Car, Shield, Building2, Users, Target, DollarSign, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const PREMIUM_TREND = [
  { month: "Jan", premium: 312000 },
  { month: "Feb", premium: 287000 },
  { month: "Mar", premium: 341000 },
  { month: "Apr", premium: 398000 },
  { month: "May", premium: 421000 },
  { month: "Jun", premium: 467000 },
];

const LEADERBOARD = [
  { name: "Sarah Mitchell", quotes: 87, bound: 62, premium: 284500, goal: 88, goalTarget: 300000, trend: "up" },
  { name: "David Chen", quotes: 74, bound: 54, premium: 241200, goal: 76, goalTarget: 280000, trend: "up" },
  { name: "Marcus Johnson", quotes: 61, bound: 41, premium: 198400, goal: 63, goalTarget: 220000, trend: "down" },
  { name: "Ashley Rivera", quotes: 58, bound: 38, premium: 174600, goal: 58, goalTarget: 190000, trend: "up" },
  { name: "Tom Kowalski", quotes: 45, bound: 28, premium: 132100, goal: 42, goalTarget: 180000, trend: "down" },
  { name: "Priya Patel", quotes: 39, bound: 24, premium: 108300, goal: 37, goalTarget: 150000, trend: "up" },
];

const LEAD_SOURCES = [
  { source: "Digital Leads", volume: 218, bound: 94, premium: 412600, convRate: 43.1 },
  { source: "Direct Mailers", volume: 156, bound: 61, premium: 287400, convRate: 39.1 },
  { source: "Local Sub-agents", volume: 98, bound: 47, premium: 231800, convRate: 48.0 },
  { source: "Referrals", volume: 74, bound: 42, premium: 198500, convRate: 56.8 },
  { source: "Walk-in", volume: 31, bound: 14, premium: 68300, convRate: 45.2 },
];

const totalPremium = 1139100;
const prevPremium = 1015300;
const premiumChange = ((totalPremium - prevPremium) / prevPremium) * 100;
const totalItems = 258;
const avgPremiumHH = 4413;
const totalQuoted = 577;
const totalBound = 247;
const closingRatio = ((totalBound / totalQuoted) * 100).toFixed(1);

const propPct = 58;
const casPct = 42;

function formatCurrency(n: number) {
  return n >= 1000000
    ? `$${(n / 1000000).toFixed(2)}M`
    : `$${(n / 1000).toFixed(0)}K`;
}

function TrendBadge({ change, suffix = "%" }: { change: number; suffix?: string }) {
  const up = change >= 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        padding: "3px 8px",
        borderRadius: "100px",
        background: up ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
        color: up ? "var(--emerald)" : "var(--red)",
        fontSize: "12px",
        fontWeight: 600,
      }}
    >
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {up ? "+" : ""}{change.toFixed(1)}{suffix}
    </span>
  );
}

function KpiCard({ title, value, subtitle, badge, children }: {
  title: string;
  value: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "20px 22px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted-foreground)" }}>
          {title}
        </span>
        {badge}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 700, color: "var(--foreground)", lineHeight: 1.1, fontFamily: "var(--font-mono)" }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: "12px", color: "var(--muted-foreground)" }}>{subtitle}</div>
      )}
      {children}
    </div>
  );
}

function MicroLobBar() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", borderRadius: "4px", overflow: "hidden", height: "6px" }}>
        <div style={{ width: `${propPct}%`, background: "var(--emerald)", transition: "width 0.5s" }} />
        <div style={{ width: `${casPct}%`, background: "#3b82f6" }} />
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: "var(--emerald)", flexShrink: 0 }} />
          <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>Property {propPct}%</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#3b82f6", flexShrink: 0 }} />
          <span style={{ fontSize: "11px", color: "var(--muted-foreground)" }}>Casualty {casPct}%</span>
        </div>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: "#1e293b", border: "1px solid var(--border)", borderRadius: "6px", padding: "8px 12px" }}>
        <div style={{ fontSize: "11px", color: "var(--muted-foreground)", marginBottom: "2px" }}>{label}</div>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--emerald)", fontFamily: "var(--font-mono)" }}>
          {formatCurrency(payload[0].value)}
        </div>
      </div>
    );
  }
  return null;
};

export function OwnerDashboard() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Row 1: KPI Cards */}
      <div style={{ display: "flex", gap: "14px" }}>

        <KpiCard
          title="Total Bound Premium"
          value={formatCurrency(totalPremium)}
          subtitle={`vs ${formatCurrency(prevPremium)} last month`}
          badge={<TrendBadge change={premiumChange} />}
        >
          <div style={{ height: "48px", marginTop: "4px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={PREMIUM_TREND} barSize={6}>
                <Bar dataKey="premium" radius={[2, 2, 0, 0]}>
                  {PREMIUM_TREND.map((_, i) => (
                    <Cell key={i} fill={i === PREMIUM_TREND.length - 1 ? "#10b981" : "#1e4d3b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </KpiCard>

        <KpiCard
          title="Items Bound / LOB Mix"
          value={totalItems.toString()}
          subtitle="Policies bound this period"
          badge={<TrendBadge change={8.3} />}
        >
          <MicroLobBar />
        </KpiCard>

        <KpiCard
          title="Avg Premium / Household"
          value={`$${avgPremiumHH.toLocaleString()}`}
          subtitle="Account density metric"
          badge={<TrendBadge change={3.1} />}
        />

        <KpiCard
          title="Agency Closing Ratio"
          value={`${closingRatio}%`}
          subtitle={`${totalBound} sold / ${totalQuoted} quoted`}
          badge={<TrendBadge change={2.4} />}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
            <div style={{ flex: 1, height: "4px", background: "var(--secondary)", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{ width: `${closingRatio}%`, height: "100%", background: "var(--emerald)", borderRadius: "2px" }} />
            </div>
            <span style={{ fontSize: "11px", color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              {closingRatio}%
            </span>
          </div>
        </KpiCard>
      </div>

      {/* Row 2: Leaderboard + Lead Source ROI */}
      <div style={{ display: "flex", gap: "14px" }}>

        {/* Leaderboard 60% */}
        <div
          style={{
            flex: "0 0 60%",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Users size={15} style={{ color: "var(--emerald)" }} />
            <span style={{ fontWeight: 700, fontSize: "13px", letterSpacing: "0.02em" }}>Producer Leaderboard</span>
            <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--muted-foreground)" }}>YTD Goal Progress</span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Rank", "Producer", "Quotes", "Bound", "Total Premium", "Goal Progress"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 16px",
                        textAlign: h === "Goal Progress" || h === "Total Premium" || h === "Bound" || h === "Quotes" ? "right" : "left",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: "var(--muted-foreground)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LEADERBOARD.map((p, i) => (
                  <tr
                    key={p.name}
                    style={{
                      borderBottom: i < LEADERBOARD.length - 1 ? "1px solid var(--border)" : "none",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ padding: "12px 16px", width: "48px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "22px",
                          height: "22px",
                          borderRadius: "50%",
                          background: i === 0 ? "var(--emerald)" : i === 1 ? "#1e4d3b" : "var(--secondary)",
                          color: i === 0 ? "#fff" : "var(--muted-foreground)",
                          fontSize: "11px",
                          fontWeight: 700,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div
                          style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "50%",
                            background: `hsl(${i * 51 + 140}, 55%, 25%)`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "var(--emerald)",
                            flexShrink: 0,
                          }}
                        >
                          {p.name.split(" ").map((n) => n[0]).join("")}
                        </div>
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--foreground)" }}>{p.name}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                            {p.trend === "up" ? (
                              <TrendingUp size={10} style={{ color: "var(--emerald)" }} />
                            ) : (
                              <TrendingDown size={10} style={{ color: "var(--red)" }} />
                            )}
                            <span style={{ fontSize: "10px", color: p.trend === "up" ? "var(--emerald)" : "var(--red)" }}>
                              {p.trend === "up" ? "On track" : "Lagging"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--foreground)" }}>
                      {p.quotes}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--foreground)" }}>
                      {p.bound}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 600, color: "var(--foreground)" }}>
                      {formatCurrency(p.premium)}
                    </td>
                    <td style={{ padding: "12px 16px", minWidth: "140px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "flex-end" }}>
                        <span style={{ fontSize: "11px", color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
                          {p.goal}% of {formatCurrency(p.goalTarget)}
                        </span>
                        <div style={{ width: "100%", height: "4px", background: "var(--secondary)", borderRadius: "2px", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${Math.min(p.goal, 100)}%`,
                              height: "100%",
                              background: p.goal >= 80 ? "var(--emerald)" : p.goal >= 60 ? "var(--amber)" : "var(--red)",
                              borderRadius: "2px",
                              transition: "width 0.5s",
                            }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Lead Source ROI 40% */}
        <div
          style={{
            flex: 1,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Target size={15} style={{ color: "var(--emerald)" }} />
            <span style={{ fontWeight: 700, fontSize: "13px" }}>Lead Source ROI Matrix</span>
          </div>

          <div style={{ padding: "0 0 8px" }}>
            <div style={{ padding: "8px 20px", display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "12px", borderBottom: "1px solid var(--border)" }}>
              {["Source", "Conv %", "Vol", "Premium"].map((h) => (
                <span key={h} style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted-foreground)", textAlign: h !== "Source" ? "right" : "left" }}>
                  {h}
                </span>
              ))}
            </div>

            {LEAD_SOURCES.map((src, i) => (
              <div
                key={src.source}
                style={{
                  padding: "13px 20px",
                  borderBottom: i < LEAD_SOURCES.length - 1 ? "1px solid var(--border)" : "none",
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  gap: "12px",
                  alignItems: "center",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--foreground)" }}>{src.source}</span>
                  <div style={{ width: "100%", height: "3px", background: "var(--secondary)", borderRadius: "2px", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${(src.premium / LEAD_SOURCES[0].premium) * 100}%`,
                        height: "100%",
                        background: "var(--emerald)",
                        opacity: 0.7,
                        borderRadius: "2px",
                      }}
                    />
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono)",
                    color: src.convRate >= 50 ? "var(--emerald)" : src.convRate >= 40 ? "var(--amber)" : "var(--muted-foreground)",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {src.convRate}%
                </span>
                <span style={{ fontSize: "12px", color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", textAlign: "right" }}>
                  {src.volume}
                </span>
                <span style={{ fontSize: "13px", fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--foreground)", textAlign: "right", whiteSpace: "nowrap" }}>
                  {formatCurrency(src.premium)}
                </span>
              </div>
            ))}
          </div>

          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", background: "rgba(16,185,129,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "var(--muted-foreground)", fontWeight: 600 }}>TOTAL ACROSS ALL SOURCES</span>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--emerald)", fontFamily: "var(--font-mono)" }}>
                {formatCurrency(LEAD_SOURCES.reduce((a, s) => a + s.premium, 0))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
