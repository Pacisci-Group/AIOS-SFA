import { Plus, User, Ticket, FileText, ChevronRight, Bell, Search } from "lucide-react";

interface QuickActionBarProps {
  householdName: string;
}

export function QuickActionBar({ householdName }: QuickActionBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
        <span className="hover:text-blue-400 cursor-pointer transition-colors">Dashboard</span>
        <ChevronRight size={12} />
        <span className="hover:text-blue-400 cursor-pointer transition-colors">Households</span>
        <ChevronRight size={12} />
        <span style={{ color: "var(--foreground)" }}>{householdName}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }} />
          <input
            placeholder="Search household…"
            className="pl-8 pr-3 py-1.5 rounded text-xs outline-none transition-all"
            style={{
              background: "var(--input-background)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
              width: "200px",
            }}
          />
        </div>

        <button className="relative p-1.5 rounded transition-colors hover:bg-white/5" style={{ color: "var(--muted-foreground)" }}>
          <Bell size={16} />
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
        </button>

        <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />

        {[
          { label: "+ Policy", icon: FileText, color: "#3b82f6" },
          { label: "+ Member", icon: User, color: "#10b981" },
          { label: "+ Ticket", icon: Ticket, color: "#f59e0b" },
          { label: "+ Start Quote", icon: Plus, color: "#8b5cf6", primary: true },
        ].map(({ label, icon: Icon, color, primary }) => (
          <button
            key={label}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:opacity-90 active:scale-95"
            style={
              primary
                ? { background: "#1d4ed8", color: "#fff", border: "1px solid #3b82f6" }
                : { background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)" }
            }
          >
            <Icon size={12} style={{ color: primary ? "#fff" : color }} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
