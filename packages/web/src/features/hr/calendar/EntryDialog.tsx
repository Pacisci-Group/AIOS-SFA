import { AlertTriangle, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import type { HrCalendarEntry } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDay, formatRange } from "@/features/hr/policies/policy-display";
import {
  EVENT_EFFECT_META,
  entryColor,
  eventTimeLabel,
  LAYER_META,
  layerOf,
} from "./calendar-display";

interface EntryDialogProps {
  entry: HrCalendarEntry;
  onClose: () => void;
  /** Set for someone who manages events, on an event entry. */
  onEditEvent?: (eventId: string) => void;
}

function when(entry: HrCalendarEntry): string {
  return entry.firstDay === entry.lastDay
    ? formatDay(entry.firstDay)
    : formatRange(entry.firstDay, entry.lastDay);
}

/**
 * What a calendar entry is, for the entries that have no page of their own
 * (PAC-169): a holiday, an event, a birthday, an anniversary, and time off
 * the viewer may see but not open. Time off they *can* open goes straight to
 * the request window instead.
 */
export function EntryDialog({ entry, onClose, onEditEvent }: EntryDialogProps) {
  const layer = LAYER_META[layerOf(entry)];
  const Icon = entry.kind === "event" ? EVENT_EFFECT_META[entry.effect].icon : layer.icon;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogDescription className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ backgroundColor: entryColor(entry) }}
            />
            <Icon aria-hidden className="size-4" />
            {layer.label}
          </DialogDescription>
          <DialogTitle className="text-base font-semibold text-foreground">
            <Title entry={entry} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-foreground">
          <p>{when(entry)}</p>
          <Body entry={entry} />
        </div>

        {entry.kind === "event" && onEditEvent && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onEditEvent(entry.eventId)}>
              <Pencil />
              Edit
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Title({ entry }: { entry: HrCalendarEntry }) {
  switch (entry.kind) {
    case "holiday":
    case "event":
      return <>{entry.name}</>;
    case "leave":
      return (
        <>
          {entry.mine ? "You" : entry.person.name}
          {entry.status === "pending"
            ? " · time off requested"
            : entry.mine
              ? " are out"
              : " is out"}
        </>
      );
    case "birthday":
      return <>{entry.person.name}’s birthday</>;
    case "anniversary":
      return (
        <>
          {entry.person.name} · {entry.years} {entry.years === 1 ? "year" : "years"} with the agency
        </>
      );
  }
}

function Body({ entry }: { entry: HrCalendarEntry }) {
  switch (entry.kind) {
    case "holiday":
      return (
        <>
          {entry.observedFor && (
            <p className="text-muted-foreground">Observed for {formatDay(entry.observedFor)}.</p>
          )}
          <p className="text-muted-foreground">
            {entry.mine ? "A holiday for you" : "Not a holiday for you"} ·{" "}
            {entry.policies.join(", ")}
          </p>
        </>
      );
    case "event": {
      const time = eventTimeLabel(entry);
      const effect = EVENT_EFFECT_META[entry.effect];
      return (
        <>
          {time && <p>{time}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm" variant="outline">
              {entry.audienceLabel}
            </Badge>
            {entry.effect !== "none" && (
              <Badge size="sm" variant={entry.effect === "blackout" ? "destructive" : "success"}>
                {effect.label}
              </Badge>
            )}
          </div>
          {entry.effect !== "none" && <p className="text-muted-foreground">{effect.hint}</p>}
          {!entry.appliesToMe && (
            <p className="text-muted-foreground">This event is not for you.</p>
          )}
          {entry.description && <p className="whitespace-pre-line">{entry.description}</p>}
        </>
      );
    }
    case "leave":
      return (
        <>
          {entry.partial && <p className="text-muted-foreground">Part of the day.</p>}
          {entry.detail?.conflicts.map((conflict) => (
            <p key={conflict.eventId} className="flex items-start gap-2 text-destructive">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {conflict.effect === "day_off" ? "Day off" : "No time off"}: {conflict.name}
              </span>
            </p>
          ))}
          {entry.detail && (
            <Link
              className="font-medium underline underline-offset-2"
              to={`/time-off/requests/${entry.detail.requestId}`}
            >
              Open the request
            </Link>
          )}
        </>
      );
    case "birthday":
    case "anniversary":
      return (
        <Link className="font-medium underline underline-offset-2" to={`/people/${entry.person.id}`}>
          Open {entry.person.name}’s profile
        </Link>
      );
  }
}
