import { Plus, User, Ticket, FileText, ChevronRight, Bell, Search } from "lucide-react";

interface QuickActionBarProps {
  householdName: string;
  /** Opens the New Service Ticket dialog. */
  onNewTicket?: () => void;
  /** Opens the Add Household Member dialog. */
  onAddMember?: () => void;
  /** Opens the Start Quote dialog (lead → quote recap). */
  onStartQuote?: () => void;
  /**
   * Why an action is unavailable, for the actions that have no handler.
   *
   * **An action without a handler renders disabled**, and this is the tooltip
   * saying why. Both halves matter: these buttons used to render fully live and
   * silently do nothing on the demo household, which reads as a broken button
   * rather than an unavailable one — there is no console error to find, because
   * nothing went wrong.
   */
  disabledReasons?: {
    addMember?: string;
    newTicket?: string;
    startQuote?: string;
  };
}

/** Shown when an action is unavailable and the caller offered no reason. */
const DEFAULT_DISABLED_REASON = "Not available on this record.";

export function QuickActionBar({
  householdName,
  onNewTicket,
  onAddMember,
  onStartQuote,
  disabledReasons = {},
}: QuickActionBarProps) {
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

        {/*
          Every label here is prefixed with its own "+" because the icon beside
          it is the *category* — a file, a person, a ticket. Start Quote's icon
          IS the plus, so a "+" in its label too rendered "+ + Start Quote".
        */}
        {[
          {
            label: "+ Policy",
            icon: FileText,
            color: "#3b82f6",
            // No handler anywhere yet — this one is still mockup.
            reason: "Adding a policy from here isn't built yet.",
          },
          {
            label: "+ Member",
            icon: User,
            color: "#10b981",
            onClick: onAddMember,
            reason: disabledReasons.addMember,
          },
          {
            label: "+ Ticket",
            icon: Ticket,
            color: "#f59e0b",
            onClick: onNewTicket,
            reason: disabledReasons.newTicket,
          },
          {
            label: "Start Quote",
            icon: Plus,
            color: "#8b5cf6",
            primary: true,
            onClick: onStartQuote,
            reason: disabledReasons.startQuote,
          },
        ].map(({ label, icon: Icon, color, primary, onClick, reason }) => {
          // The handler IS the availability signal — there is no separate
          // `disabled` prop to fall out of sync with it.
          const disabled = !onClick;
          return (
            <button
              key={label}
              type="button"
              onClick={onClick}
              disabled={disabled}
              // `title` rather than the `Tooltip` primitive: a disabled button
              // fires no pointer events, so Radix's trigger never sees the
              // hover. The native tooltip is the one that still shows.
              title={disabled ? (reason ?? DEFAULT_DISABLED_REASON) : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all enabled:hover:opacity-90 enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              style={
                primary
                  ? { background: "#1d4ed8", color: "#fff", border: "1px solid #3b82f6" }
                  : { background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)" }
              }
            >
              <Icon size={12} style={{ color: primary ? "#fff" : color }} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
