import type { TimeOffTimelineEntryView } from "@sfa/shared";
import { cn } from "@/lib/utils";
import { formatWhen, TIMELINE_LABEL } from "../time-off-request-display";

/**
 * What happened to a request, oldest first (PAC-165): who did it, when,
 * and the note they wrote with it — the only place a note is written, so
 * this is also the conversation. The Notes & activity idiom of the lead
 * page: a rail of dots, a note set apart as a quote.
 */
export function RequestTimeline({ entries }: { entries: readonly TimeOffTimelineEntryView[] }) {
  if (entries.length === 0) return null;
  return (
    <ol>
      {entries.map((entry, index) => {
        const last = index === entries.length - 1;
        return (
          <li key={`${entry.at}-${entry.action}`} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span aria-hidden className="absolute top-3 bottom-0 left-[5px] w-px bg-border" />
            )}
            <span
              aria-hidden
              className={cn(
                "relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-card",
                last ? "bg-primary" : "bg-muted-foreground/50",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{TIMELINE_LABEL[entry.action]}</p>
              <p className="text-xs text-muted-foreground">
                {entry.actor?.name ?? "Automatic"} · {formatWhen(entry.at)}
              </p>
              {entry.note && (
                <p className="mt-2 whitespace-pre-line rounded-r-md border-l-2 border-primary/50 bg-sunken py-2 pr-2 pl-3 text-sm text-foreground">
                  {entry.note}
                </p>
              )}
              {entry.warnings.length > 0 && (
                <p className="mt-1 text-xs text-destructive">
                  Recorded over a limit: {entry.warnings.map(warningLabel).join(", ")}.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function warningLabel(code: string): string {
  switch (code) {
    case "negative_balance":
      return "the balance";
    case "usage_cap":
      return "the yearly usage cap";
    case "waiting_period":
      return "the waiting period";
    case "blackout":
      return "a day with no time off";
    default:
      return code;
  }
}
