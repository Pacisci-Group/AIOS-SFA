import { SERVICE_TICKET_ARCHIVE_AFTER_DAYS } from "@sfa/shared";
import { ticketUrgencyBand } from "@/lib/ticket-urgency";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/common/DetailCard";
import type { Ticket } from "./ticket-data";

interface KpiStripProps {
  tickets: Ticket[];
}

/**
 * The four counts above the workspace — over the whole queue, not the filtered
 * view. The feed below carries its own count of what the filters matched.
 *
 * Counted by urgency band rather than by raw status, which is what the feed's
 * status tabs do (`matchesTicketQueueTab`), so these agree with the tab counts
 * a rep sees one row down. Testing `status === 'waiting'` left the finer
 * `waiting_on_client` / `waiting_on_carrier` states out of "Waiting" and
 * `closed` counted as open work.
 *
 * Two-up on a phone and four-up from `sm`: the original was a fixed four-column
 * row that squeezed a 30px numeral and its two labels into ~90px on a handset.
 */
export function KpiStrip({ tickets }: KpiStripProps) {
  const bands = tickets.map((t) => ticketUrgencyBand(t.status));
  const total = bands.filter((band) => band !== "done").length;
  const overdue = bands.filter((band) => band === "overdue").length;
  const waiting = bands.filter((band) => band === "blocked").length;
  const resolved = bands.filter((band) => band === "done").length;

  return (
    <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
      <KpiItem
        label="Total open"
        value={total}
        tone="text-primary"
        subLabel="active tickets"
      />
      {/* Red, like every other "overdue" in the app — this KPI counts exactly
          what the feed's Overdue tab lists, so it takes that badge's colour
          rather than `--destructive`, which now means "due soon". */}
      <KpiItem
        label="Needs action"
        value={overdue}
        tone="text-red-600 dark:text-red-400"
        subLabel="overdue"
        pulse="bg-red-500 dark:bg-red-400"
      />
      <KpiItem
        label="Waiting"
        value={waiting}
        tone="text-violet-600 dark:text-violet-400"
        subLabel="on client or underwriter"
      />
      {/* Not "today", which is what this said: the active queue holds every
          ticket resolved inside the archive window, and the older ones are on
          the Archived Tickets page. */}
      <KpiItem
        label="Resolved"
        value={resolved}
        tone="text-success"
        subLabel={`last ${SERVICE_TICKET_ARCHIVE_AFTER_DAYS} days`}
      />
    </div>
  );
}

interface KpiItemProps {
  label: string;
  value: number;
  tone: string;
  subLabel: string;
  /** Background class for the attention dot; omitted means no dot. */
  pulse?: string;
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
          <span
            className={cn(
              "absolute -right-2 -top-1 size-2 animate-pulse rounded-full",
              pulse,
            )}
          />
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
