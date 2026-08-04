import type { LeadDetailActivity } from "@sfa/shared";
import { cn } from "@/lib/utils";
import { activityDisplay, activityLabel } from "./lead-display";

interface ActivityTimelineProps {
  activities: LeadDetailActivity[];
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
 * Notes & Activity — this lead's history, newest first.
 *
 * Read-only. The mockup has a "Log a note or call…" composer, and the version
 * of this file it came from implemented it against local state: notes appeared,
 * then vanished on the next render. There is no `POST /activities` yet, so the
 * control is removed rather than left looking functional — the quick actions
 * that will fill it are PAC-16.
 *
 * Renders whatever types exist rather than assuming a set: only `lead_created`,
 * `quoted`, `sold` and `audit_resolved` are written today, and `call` / `text` /
 * `email` / `note` arrive with those quick actions.
 */
export function ActivityTimeline({ activities }: ActivityTimelineProps) {
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
        <p className="px-5 py-4 text-sm text-muted-foreground">
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
    </section>
  );
}
