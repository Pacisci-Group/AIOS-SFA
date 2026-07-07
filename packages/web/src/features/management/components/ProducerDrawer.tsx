import { X, Phone, FileText, CheckCircle2, Clock, TrendingUp, AlertCircle, ChevronRight } from "lucide-react";

type Producer = {
  name: string;
  callsMade: number;
  quotesIssued: number;
  dealsClosed: number;
  pendingActions: number;
  status: "active" | "idle" | "busy";
};

type ProducerDrawerProps = {
  producer: Producer | null;
  onClose: () => void;
};

const ACTIVE_LEADS = [
  { name: "Robert & Linda Gaines", line: "Auto + Home", stage: "Quote Sent", age: "2h ago", value: 3800 },
  { name: "Marcus Webb", line: "Home", stage: "Follow-up Call", age: "4h ago", value: 2100 },
  { name: "Chen Family Trust", line: "Umbrella", stage: "Application Sent", age: "Yesterday", value: 6400 },
  { name: "Theresa Moreno", line: "Auto", stage: "Quoted", age: "Yesterday", value: 1850 },
  { name: "James & Susan Park", line: "Landlord", stage: "Needs Review", age: "2d ago", value: 4200 },
];

const PENDING_ITEMS = [
  { task: "Follow up: Robert Gaines quote expiring", urgency: "high", due: "Today, 3PM" },
  { task: "Submit Chen Family bind request", urgency: "medium", due: "Today, 5PM" },
  { task: "Call back Marcus Webb – voicemail left", urgency: "low", due: "Tomorrow" },
];

const stageColor: Record<string, string> = {
  "Quote Sent": "#3b82f6",
  "Follow-up Call": "var(--amber)",
  "Application Sent": "var(--emerald)",
  "Quoted": "#8b5cf6",
  "Needs Review": "var(--red)",
};

export function ProducerDrawer({ producer, onClose }: ProducerDrawerProps) {
  if (!producer) return null;

  const initials = producer.name.split(" ").map((n) => n[0]).join("");
  const closingRatio = producer.quotesIssued > 0
    ? ((producer.dealsClosed / producer.quotesIssued) * 100).toFixed(0)
    : "0";

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 40,
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "420px",
          background: "#0f172a",
          borderLeft: "1px solid var(--border)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* Drawer Header */}
        <div style={{ padding: "20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #10b981, #059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "15px",
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--foreground)" }}>{producer.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: producer.status === "active" ? "var(--emerald)" : producer.status === "busy" ? "var(--amber)" : "#64748b",
                }}
              />
              <span style={{ fontSize: "12px", color: "var(--muted-foreground)", textTransform: "capitalize" }}>
                {producer.status}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "var(--secondary)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--muted-foreground)",
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Today's Stats Strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {[
            { icon: <Phone size={13} />, label: "Calls", value: producer.callsMade },
            { icon: <FileText size={13} />, label: "Quotes", value: producer.quotesIssued },
            { icon: <CheckCircle2 size={13} />, label: "Closed", value: producer.dealsClosed },
            { icon: <TrendingUp size={13} />, label: "Close %", value: `${closingRatio}%` },
          ].map((stat, i) => (
            <div
              key={stat.label}
              style={{
                padding: "14px 0",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                borderRight: i < 3 ? "1px solid var(--border)" : "none",
              }}
            >
              <div style={{ color: "var(--emerald)" }}>{stat.icon}</div>
              <div style={{ fontSize: "18px", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}>
                {stat.value}
              </div>
              <div style={{ fontSize: "10px", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Pending Actions */}
        {producer.pendingActions > 0 && (
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
              <AlertCircle size={13} style={{ color: "var(--amber)" }} />
              <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--amber)" }}>
                Pending Action Items ({producer.pendingActions})
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {PENDING_ITEMS.slice(0, producer.pendingActions).map((item) => (
                <div
                  key={item.task}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 10px",
                    background: "var(--secondary)",
                    borderRadius: "6px",
                    borderLeft: `3px solid ${item.urgency === "high" ? "var(--red)" : item.urgency === "medium" ? "var(--amber)" : "var(--muted-foreground)"}`,
                  }}
                >
                  <Clock size={11} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12px", color: "var(--foreground)", fontWeight: 500 }}>{item.task}</div>
                    <div style={{ fontSize: "10px", color: "var(--muted-foreground)" }}>{item.due}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Leads Pipeline */}
        <div style={{ padding: "16px 20px", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
            <ChevronRight size={13} style={{ color: "var(--emerald)" }} />
            <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted-foreground)" }}>
              Active Pipeline
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {ACTIVE_LEADS.map((lead) => (
              <div
                key={lead.name}
                style={{
                  padding: "10px 12px",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  transition: "border-color 0.15s",
                  cursor: "default",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "rgba(16,185,129,0.3)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)")}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--foreground)" }}>{lead.name}</div>
                  <div style={{ fontSize: "11px", color: "var(--muted-foreground)", marginTop: "1px" }}>{lead.line} · {lead.age}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px", flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: `${stageColor[lead.stage]}22`,
                      color: stageColor[lead.stage],
                      whiteSpace: "nowrap",
                    }}
                  >
                    {lead.stage}
                  </span>
                  <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}>
                    ${lead.value.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
