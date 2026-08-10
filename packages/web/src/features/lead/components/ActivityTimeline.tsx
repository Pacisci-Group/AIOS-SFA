import type { ActivityOrigin, LeadDetailActivity } from "@sfa/shared";
import { ACTIVITY_ORIGIN_LABELS } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
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
 *
 * ## Notes read as notes (PAC-56 #29)
 *
 * A note used to render exactly like a logged call — one line of text in a
 * timeline row — so it was neither identifiable as a note nor traceable to where
 * it was written. Two changes fix that:
 *
 * - **Notes get their own treatment**: the text sits in a sunken quote block
 *   with an accent rule, so a written thought is visibly different from an event
 *   the system recorded.
 * - **Every row carries its provenance**: who wrote it, when, and which surface
 *   it came from. The origin chip is shown only when it is *not* the lead
 *   itself — on a page about this lead, "Lead" on every row is noise, and the
 *   rows worth spotting are the ones that arrived from the quote recap or the
 *   sold flow.
 */
export function ActivityTimeline({
  activities,
  leadId,
}: ActivityTimelineProps) {
  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-card-foreground">
          Notes &amp; activity
        </h2>
        <span className="text-sm text-muted-foreground">
          {activities.length} {activities.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {activities.length === 0 ? (
        <p className="flex-1 px-5 py-4 text-base text-muted-foreground">
          Nothing has been logged against this lead yet.
        </p>
      ) : (
        <ol className="flex-1 overflow-y-auto px-5 py-3">
          {activities.map((activity, index) => {
            const { icon: Icon, tone, tint } = activityDisplay[activity.type];
            const isLast = index === activities.length - 1;
            const isNote = activity.type === "note";
            // `POST /activities` defaults an untyped touch's summary to the
            // type's own label, so a bare "Call logged" would otherwise render
            // twice — once as the heading, once as the body.
            const body =
              activity.summary && activity.summary !== activityLabel[activity.type]
                ? activity.summary
                : null;

            return (
              <li key={activity.id} className="relative flex gap-3">
                {/* The connector, stopping at the last entry. */}
                {!isLast && (
                  <span
                    aria-hidden
                    className="absolute bottom-0 left-4 top-10 w-px bg-border"
                  />
                )}

                <span
                  aria-hidden
                  className={cn(
                    "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                    tint,
                  )}
                >
                  <Icon className={cn("size-4", tone)} />
                </span>

                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={cn(
                        "text-base font-medium",
                        isNote ? "text-muted-foreground" : "text-card-foreground",
                      )}
                    >
                      {isNote ? "Note" : activityLabel[activity.type]}
                    </p>
                    <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                      {formatWhen(activity.occurredAt)}
                    </span>
                  </div>

                  {isNote
                    ? /*
                       * The note's own words, set apart from the surrounding
                       * event rows. `whitespace-pre-line` because the composer
                       * is a textarea and a producer's line breaks are
                       * meaningful.
                       */
                      body && (
                        <p className="mt-1.5 whitespace-pre-line rounded-r-md border-l-2 border-destructive/50 bg-sunken py-2 pl-3 pr-2 text-base text-card-foreground">
                          {body}
                        </p>
                      )
                    : body && (
                        <p className="mt-0.5 text-base text-card-foreground">
                          {body}
                        </p>
                      )}

                  <Provenance
                    producerName={activity.producerName}
                    origin={activity.origin}
                    tone={tone}
                  />
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

/**
 * Who wrote it and where (#29).
 *
 * The origin chip is suppressed for `lead`, which is where the overwhelming
 * majority of rows come from — labelling every row on a lead page "Lead" is
 * noise that hides the two or three rows whose origin actually matters.
 *
 * `system` covers migrated rows and anything the platform generated with no
 * human author; it is shown, because "this came from the old system" is exactly
 * the kind of thing a producer needs to know before trusting a summary.
 */
function Provenance({
  producerName,
  origin,
  tone,
}: {
  producerName: string | null;
  origin: ActivityOrigin;
  tone: string;
}) {
  const showOrigin = origin !== "lead";
  if (!producerName && !showOrigin) return null;

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {producerName && <span className={tone}>{producerName}</span>}
      {showOrigin && (
        <Badge size="sm" variant="secondary" className="text-muted-foreground">
          {ACTIVITY_ORIGIN_LABELS[origin]}
        </Badge>
      )}
    </p>
  );
}
