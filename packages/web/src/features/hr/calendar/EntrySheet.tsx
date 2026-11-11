import { AlertTriangle, Pencil, Users } from "lucide-react";
import { Link } from "react-router-dom";
import {
  AgencyPermission,
  type HrCalendarEntry,
  type HrCalendarHolidayPolicy,
  type HrCalendarPersonRef,
} from "@sfa/shared";
import { SectionLabel } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonSheet } from "@/features/people/sheets/PersonSheet";
import { formatDay, formatRange } from "@/features/hr/policies/policy-display";
import { usePermissions } from "@/hooks/usePermissions";
import {
  EVENT_EFFECT_META,
  entryColor,
  eventTimeLabel,
  LAYER_META,
  layerOf,
} from "./calendar-display";

interface EntrySheetProps {
  entry: HrCalendarEntry;
  /** The Holiday policies the calendar read named, with their people. */
  holidayPolicies: readonly HrCalendarHolidayPolicy[];
  onClose: () => void;
  /** Set for someone who manages events, on an event entry. */
  onEditEvent?: (eventId: string) => void;
}

function when(entry: HrCalendarEntry): string {
  return entry.firstDay === entry.lastDay
    ? formatDay(entry.firstDay)
    : formatRange(entry.firstDay, entry.lastDay);
}

function title(entry: HrCalendarEntry): string {
  switch (entry.kind) {
    case "holiday":
    case "event":
      return entry.name;
    case "leave":
      if (entry.status === "pending") {
        return `${entry.mine ? "You" : entry.person.name} · time off requested`;
      }
      return entry.mine ? "You are out" : `${entry.person.name} is out`;
    case "birthday":
      return `${entry.person.name}’s birthday`;
    case "anniversary":
      return `${entry.person.name} · ${entry.years} ${entry.years === 1 ? "year" : "years"} with the agency`;
  }
}

/**
 * What a calendar entry is (PAC-169), in the same right-hand sheet every
 * other record on this page opens in — a holiday, an event, a birthday, an
 * anniversary, and time off the viewer may see but not open. Time off they
 * *can* open goes straight to the request window instead.
 */
export function EntrySheet({
  entry,
  holidayPolicies,
  onClose,
  onEditEvent,
}: EntrySheetProps) {
  const layer = LAYER_META[layerOf(entry)];
  const Icon =
    entry.kind === "event" ? EVENT_EFFECT_META[entry.effect].icon : layer.icon;

  return (
    <PersonSheet eyebrow={layer.label} title={title(entry)} onClose={onClose}>
      <div className="flex-1 space-y-5 px-6 py-5">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: entryColor(entry) }}
          />
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span>{when(entry)}</span>
        </div>
        <Body entry={entry} holidayPolicies={holidayPolicies} />
      </div>
      {entry.kind === "event" && onEditEvent && (
        <div className="flex justify-end border-t border-border px-6 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditEvent(entry.eventId)}
          >
            <Pencil />
            Edit event
          </Button>
        </div>
      )}
    </PersonSheet>
  );
}

function Body({
  entry,
  holidayPolicies,
}: {
  entry: HrCalendarEntry;
  holidayPolicies: readonly HrCalendarHolidayPolicy[];
}) {
  switch (entry.kind) {
    case "holiday":
      return (
        <>
          {entry.observedFor && (
            <p className="text-sm text-muted-foreground">
              Observed for {formatDay(entry.observedFor)}.
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {entry.mine ? "A holiday for you." : "Not a holiday for you."}
          </p>
          <HolidayPolicies
            policies={entry.policies.map(
              (ref) =>
                holidayPolicies.find((policy) => policy.id === ref.id) ?? {
                  ...ref,
                  members: [],
                },
            )}
          />
        </>
      );
    case "event": {
      const time = eventTimeLabel(entry);
      const effect = EVENT_EFFECT_META[entry.effect];
      return (
        <>
          {time && <p className="text-sm text-foreground">{time}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Badge size="sm" variant="outline">
              {entry.audienceLabel}
            </Badge>
            {entry.effect !== "none" && (
              <Badge
                size="sm"
                variant={
                  entry.effect === "blackout" ? "destructive" : "success"
                }
              >
                {effect.label}
              </Badge>
            )}
          </div>
          {entry.effect !== "none" && (
            <p className="text-sm text-muted-foreground">{effect.hint}</p>
          )}
          {!entry.appliesToMe && (
            <p className="text-sm text-muted-foreground">
              This event is not for you.
            </p>
          )}
          {entry.description && (
            <p className="whitespace-pre-line text-sm text-foreground">
              {entry.description}
            </p>
          )}
        </>
      );
    }
    case "leave":
      return (
        <>
          {entry.partial && (
            <p className="text-sm text-muted-foreground">Part of the day.</p>
          )}
          {entry.detail?.conflicts.map((conflict) => (
            <p
              key={conflict.eventId}
              className="flex items-start gap-2 text-sm text-destructive"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {conflict.effect === "day_off" ? "Day off" : "No time off"}:{" "}
                {conflict.name}
              </span>
            </p>
          ))}
          {entry.detail ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/time-off/requests/${entry.detail.requestId}`}>
                Open the request
              </Link>
            </Button>
          ) : (
            <PersonLink person={entry.person} />
          )}
        </>
      );
    case "birthday":
    case "anniversary":
      return <PersonLink person={entry.person} />;
  }
}

function PersonLink({ person }: { person: HrCalendarPersonRef }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={`/people/${person.id}`}>Open {person.name}’s profile</Link>
    </Button>
  );
}

/**
 * The Holiday policies that close the day, each with its people. The policy
 * name is a link for someone who may open Settings → HR policies; everyone
 * else reads it as text. Several policies observing the same day is the
 * normal case in an agency with more than one Holiday policy.
 */
function HolidayPolicies({
  policies,
}: {
  policies: HrCalendarHolidayPolicy[];
}) {
  const { can } = usePermissions();
  const admin = can(AgencyPermission.HrAdmin);
  return (
    <section>
      <SectionLabel>
        {policies.length === 1 ? "Holiday policy" : "Holiday policies"}
      </SectionLabel>
      <ul className="mt-2 space-y-4">
        {policies.map((policy) => (
          <li key={policy.id} className="rounded-lg border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              {admin ? (
                <Link
                  to={`/settings/hr-policies/${policy.id}`}
                  className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {policy.name}
                </Link>
              ) : (
                <span className="text-sm font-medium text-foreground">
                  {policy.name}
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users aria-hidden className="size-3.5" />
                {policy.members.length}
              </span>
            </div>
            {policy.members.length === 0 ? (
              <p className="px-4 py-2.5 text-sm text-muted-foreground">
                Nobody is in this policy.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {policy.members.map((member) => (
                  <li key={member.id} className="px-4 py-2 text-sm">
                    <Link
                      to={`/people/${member.id}`}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {member.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
