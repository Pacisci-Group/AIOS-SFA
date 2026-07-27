import { Ticket } from "./ticket-data";

interface KpiStripProps {
  tickets: Ticket[];
}

export function KpiStrip({ tickets }: KpiStripProps) {
  const total = tickets.filter((t) => t.status !== "resolved").length;
  const overdue = tickets.filter((t) => t.status === "overdue").length;
  const waiting = tickets.filter((t) => t.status === "waiting").length;
  const resolved = tickets.filter((t) => t.status === "resolved").length;

  return (
    <div className="flex items-stretch gap-px bg-border border-b border-border">
      <KpiItem
        label="Total Open"
        value={total}
        colorClass="text-[var(--kpi-blue)]"
        bgClass="bg-card"
        subLabel="active tickets"
      />
      <KpiItem
        label="Needs Action"
        value={overdue}
        colorClass="text-[var(--kpi-amber)]"
        bgClass="bg-card"
        subLabel="overdue"
        pulse
      />
      <KpiItem
        label="Waiting"
        value={waiting}
        colorClass="text-[var(--kpi-purple)]"
        bgClass="bg-card"
        subLabel="on client or underwriter"
      />
      <KpiItem
        label="Resolved Today"
        value={resolved}
        colorClass="text-[var(--kpi-green)]"
        bgClass="bg-card"
        subLabel="closed"
      />
    </div>
  );
}

interface KpiItemProps {
  label: string;
  value: number;
  colorClass: string;
  bgClass: string;
  subLabel: string;
  pulse?: boolean;
}

function KpiItem({ label, value, colorClass, bgClass, subLabel, pulse }: KpiItemProps) {
  return (
    <div className={`flex-1 flex items-center gap-3 px-5 py-3 ${bgClass}`}>
      <div className="relative">
        <span className={`font-mono text-3xl font-semibold tabular-nums leading-none ${colorClass}`}>
          {value}
        </span>
        {pulse && value > 0 && (
          <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-foreground tracking-wide uppercase">{label}</span>
        <span className="text-xs text-muted-foreground">{subLabel}</span>
      </div>
    </div>
  );
}
