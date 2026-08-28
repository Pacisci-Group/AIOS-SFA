import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/common/DetailCard";
import type { Ticket } from "./ticket-data";

interface KpiStripProps {
  tickets: Ticket[];
}

/**
 * The four counts above the workspace.
 *
 * Two-up on a phone and four-up from `sm`: the original was a fixed four-column
 * row that squeezed a 30px numeral and its two labels into ~90px on a handset.
 */
export function KpiStrip({ tickets }: KpiStripProps) {
  const total = tickets.filter((t) => t.status !== "resolved").length;
  const overdue = tickets.filter((t) => t.status === "overdue").length;
  const waiting = tickets.filter((t) => t.status === "waiting").length;
  const resolved = tickets.filter((t) => t.status === "resolved").length;

  return (
    <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
      <KpiItem
        label="Total open"
        value={total}
        tone="text-primary"
        subLabel="active tickets"
      />
      <KpiItem
        label="Needs action"
        value={overdue}
        tone="text-destructive"
        subLabel="overdue"
        pulse
      />
      <KpiItem
        label="Waiting"
        value={waiting}
        tone="text-violet-600 dark:text-violet-400"
        subLabel="on client or underwriter"
      />
      <KpiItem
        label="Resolved today"
        value={resolved}
        tone="text-success"
        subLabel="closed"
      />
    </div>
  );
}

interface KpiItemProps {
  label: string;
  value: number;
  tone: string;
  subLabel: string;
  pulse?: boolean;
}

function KpiItem({ label, value, tone, subLabel, pulse }: KpiItemProps) {
  return (
    <div className="flex items-center gap-3 bg-card px-4 py-3 md:px-5">
      <div className="relative">
        <span
          className={cn(
            "text-3xl font-semibold leading-none tabular-nums",
            tone,
          )}
        >
          {value}
        </span>
        {pulse && value > 0 && (
          <span className="absolute -right-2 -top-1 size-2 animate-pulse rounded-full bg-destructive" />
        )}
      </div>
      <div className="flex min-w-0 flex-col">
        <SectionLabel className="text-card-foreground">{label}</SectionLabel>
        <span className="truncate text-xs text-muted-foreground">
          {subLabel}
        </span>
      </div>
    </div>
  );
}
