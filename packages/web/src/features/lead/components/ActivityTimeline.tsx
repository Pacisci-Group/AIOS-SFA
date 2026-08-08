import type { LeadDetailActivity } from "@sfa/shared";
import { cn } from "@/lib/utils";
import { ActivityComposer } from "./ActivityComposer";
import { activityDisplay, activityLabel } from "./lead-display";

interface ActivityTimelineProps {
  activities: LeadDetailActivity[];
  /** Needed by the composer, which logs against this lead. */
  leadId: string;
}

/** `Today, 10:42 AM` / `Yesterday, 4:30 PM` / `Jun 5, 8:00 AM`. */
function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const startOfDay = (input: Date) =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86_400_000,
  );

  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  })}, ${time}`;
}

/**
 * Notes & Activity — this lead's history, newest first, with a composer.
 *
 * The composer was removed in PAC-38: the version inherited from the Figma
 * export wrote to local state, so notes appeared and then vanished on the next
 * render, and there was no endpoint to point it at. PAC-16 added
 * `POST /activities` and it is back, as `ActivityComposer` — the same endpoint
 * the dashboard's Call/Text/Email quick actions use.
 *
 * Renders whatever types exist rather than assuming a set. `lead_created`,
 * `quoted`, `sold` and `audit_resolved` come from their own pipelines; `call`,
 * `text`, `email` and `note` are client-written.
 */
export function ActivityTimeline({
  activities,
  leadId,
}: ActivityTimelineProps) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Notes &amp; Activity
        </h2>
        <span className="text-xs text-muted-foreground">
          {activities.length} {activities.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {activities.length === 0 ? (
        <p className="flex-1 px-5 py-4 text-sm text-muted-foreground">
          Nothing has been logged against this lead yet.
        </p>
      ) : (
        <ol className="flex-1 overflow-y-auto px-5 py-3">
          {activities.map((activity, index) => {
            const { icon: Icon, tone, tint } = activityDisplay[activity.type];
            const isLast = index === activities.length - 1;

            return (
              <li key={activity.id} className="relative flex gap-3">
                {/* The connector, stopping at the last entry. */}
                {!isLast && (
                  <span
                    aria-hidden
                    className="absolute bottom-0 left-3 top-8 w-px bg-border"
                  />
                )}

                <span
                  aria-hidden
                  className={cn(
                    "relative z-10 mt-1 flex size-6 shrink-0 items-center justify-center rounded-full",
                    tint,
                  )}
                >
                  <Icon size={11} className={tone} />
                </span>

                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-card-foreground">
                      {activity.summary ?? activityLabel[activity.type]}
                    </p>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      {formatWhen(activity.occurredAt)}
                    </span>
                  </div>
                  {activity.producerName && (
                    <p className={cn("mt-1 text-xs", tone)}>
                      {activity.producerName}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Pinned below the scrolling list, so it stays reachable on a lead with
          a long history. */}
      <ActivityComposer leadId={leadId} />
    </section>
  );
}
