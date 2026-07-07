import { useState } from "react";
import { Phone, MessageSquare, FileText, Settings, User, Plus, Send } from "lucide-react";

type ActivityType = "call" | "note" | "quote" | "system" | "email";

interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  body?: string;
  timestamp: string;
  user: string;
}

const activities: Activity[] = [
  {
    id: "1",
    type: "call",
    title: "Outbound call — 12 min",
    body: "Discussed current State Farm renewal. Client frustrated with 18% rate increase. Interested in exploring options. Confirmed household info.",
    timestamp: "Today, 10:42 AM",
    user: "MR",
  },
  {
    id: "2",
    type: "quote",
    title: "Quote generated — Progressive Auto",
    body: "Full quote package built. $156/mo vs $195/mo current. Sent recap PDF to client email.",
    timestamp: "Today, 9:15 AM",
    user: "System",
  },
  {
    id: "3",
    type: "note",
    title: "Note added",
    body: "Client prefers text over email. Best time to reach: mornings before 11am. Has teenage driver (Priya, 17) being added soon.",
    timestamp: "Yesterday, 4:30 PM",
    user: "MR",
  },
  {
    id: "4",
    type: "email",
    title: "Quote recap sent via email",
    body: "Side-by-side comparison emailed to anurodh.vaidya@gmail.com",
    timestamp: "Yesterday, 4:35 PM",
    user: "System",
  },
  {
    id: "5",
    type: "system",
    title: "Lead status changed → Hot",
    timestamp: "Yesterday, 3:00 PM",
    user: "System",
  },
  {
    id: "6",
    type: "call",
    title: "Inbound call — 4 min",
    body: "Client called to confirm appointment for Thursday. Left VM.",
    timestamp: "Jun 6, 2:10 PM",
    user: "MR",
  },
  {
    id: "7",
    type: "system",
    title: "Lead created — Referred by David Chen",
    timestamp: "Jun 5, 8:00 AM",
    user: "System",
  },
];

const typeConfig: Record<ActivityType, { icon: React.ElementType; color: string; bg: string }> = {
  call: { icon: Phone, color: "var(--sky)", bg: "rgba(14,165,233,0.12)" },
  note: { icon: MessageSquare, color: "var(--amber)", bg: "rgba(245,158,11,0.12)" },
  quote: { icon: FileText, color: "var(--emerald)", bg: "rgba(16,185,129,0.12)" },
  system: { icon: Settings, color: "var(--muted-foreground)", bg: "var(--muted)" },
  email: { icon: Send, color: "#8b5cf6", bg: "rgba(139,92,246,0.12)" },
};

export function ActivityTimeline() {
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Activity[]>(activities);

  const addNote = () => {
    if (!note.trim()) return;
    const newItem: Activity = {
      id: String(Date.now()),
      type: "note",
      title: "Note added",
      body: note.trim(),
      timestamp: "Just now",
      user: "MR",
    };
    setItems([newItem, ...items]);
    setNote("");
  };

  return (
    <div className="bg-card rounded-lg border border-border flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h3 className="text-sm text-card-foreground" style={{ fontWeight: 600 }}>Notes & Activity</h3>
        <span className="text-xs text-muted-foreground">{items.length} entries</span>
      </div>

      {/* Quick note input */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex gap-2">
          <div className="size-6 rounded-full flex items-center justify-center text-white shrink-0 mt-0.5" style={{ background: "var(--sky)", fontSize: 10, fontWeight: 700 }}>
            MR
          </div>
          <div className="flex-1 flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNote()}
              placeholder="Log a note or call..."
              className="flex-1 text-xs bg-muted/50 rounded-md px-3 py-2 outline-none border border-transparent focus:border-border placeholder:text-muted-foreground/60"
            />
            <button
              onClick={addNote}
              className="px-3 py-1.5 rounded-md text-white transition-opacity hover:opacity-80"
              style={{ background: "var(--sky)", fontSize: 12, fontWeight: 600 }}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Timeline scroll area */}
      <div className="overflow-y-auto flex-1 px-4 py-3 space-y-0" style={{ scrollbarWidth: "none" }}>
        {items.map((item, i) => {
          const cfg = typeConfig[item.type];
          const Icon = cfg.icon;
          const isLast = i === items.length - 1;
          return (
            <div key={item.id} className="flex gap-3 relative">
              {/* Vertical line */}
              {!isLast && (
                <div className="absolute left-3 top-8 bottom-0 w-px bg-border" style={{ zIndex: 0 }} />
              )}
              {/* Icon dot */}
              <div
                className="size-6 rounded-full flex items-center justify-center shrink-0 relative z-10 mt-1"
                style={{ background: cfg.bg }}
              >
                <Icon size={11} style={{ color: cfg.color }} />
              </div>
              {/* Content */}
              <div className="pb-4 flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs text-card-foreground" style={{ fontWeight: 500 }}>{item.title}</p>
                  <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">{item.timestamp}</span>
                </div>
                {item.body && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.body}</p>
                )}
                {item.user !== "System" && (
                  <p className="text-xs mt-1" style={{ color: cfg.color }}>{item.user}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
