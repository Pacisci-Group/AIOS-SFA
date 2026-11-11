import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays } from "lucide-react";
import type { HrCalendarEntry, TimeOffRequestView } from "@sfa/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { RequestSheet } from "@/features/time-off/request/RequestSheet";
import { RequestViewSheet } from "@/features/time-off/view/RequestViewSheet";
import { useAuth } from "@/contexts/auth-context";
import { useUrlState } from "@/hooks/useUrlState";
import { agencyTodayYmd } from "@/lib/dates";
import {
  getAgencyEvent,
  getHrCalendar,
  getHrCalendarFilters,
  hrCalendarKeys,
} from "@/lib/hr-calendar-api";
import { CalendarToolbar } from "./CalendarToolbar";
import { layerOf, type CalendarLayer } from "./calendar-display";
import { DaySheet } from "./DaySheet";
import { EntrySheet } from "./EntrySheet";
import { EventSheet } from "./EventSheet";
import { HrCalendar, type CalendarRange } from "./HrCalendar";

const URL_DEFAULTS = { branch: [] as string[], employee: [] as string[] };

/** What is open on top of the calendar — one sheet at a time. */
type Overlay =
  | { kind: "entry"; entry: HrCalendarEntry }
  | { kind: "day"; date: string }
  | { kind: "request"; requestId: string }
  | { kind: "editRequest"; request: TimeOffRequestView }
  | { kind: "event"; eventId: string | null; range?: CalendarRange };

/**
 * The HR calendar (PAC-169) — every employee's page: the holidays, the
 * agency's events, birthdays and work anniversaries, and time off.
 *
 * **Whose time off** is the server's decision (`GET /hr/calendar`): your own
 * always; other people's only with `agency:hr:team_calendar`, for your
 * branch or the whole agency. The page draws what it is given and asks the
 * response — not the permission list — whether to offer the filters and the
 * **Add event** button (`viewer.managesEvents`, i.e. `agency:hr:admin`).
 *
 * Everything opens in the same right-hand sheet. Time off you may open
 * (your own, or as a reviewer) opens the request window the Time off page
 * uses; every other entry opens a sheet saying what it is. On a phone the
 * month grid is a day picker, and a day opens a sheet listing it.
 *
 * The filters live in the query string, so a manager's "my branch" view
 * survives a reload and can be shared as a link.
 */
export default function CalendarPage() {
  const { user } = useAuth();
  const today = agencyTodayYmd(user?.timeZone);
  // Decided once: switching the initial view under a resize would move the
  // reader off the month they were looking at.
  const [compact] = useState(
    () => window.matchMedia("(max-width: 639px)").matches,
  );

  const [range, setRange] = useState<CalendarRange | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<CalendarLayer>>(new Set());
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [filter, setFilter] = useUrlState({ defaults: URL_DEFAULTS });

  const calendar = useQuery({
    queryKey: hrCalendarKeys.range({
      from: range?.from ?? "",
      to: range?.to ?? "",
      branchId: filter.branch,
      employeeId: filter.employee,
    }),
    queryFn: () =>
      getHrCalendar({
        from: range!.from,
        to: range!.to,
        branchId: filter.branch,
        employeeId: filter.employee,
      }),
    enabled: range !== null,
    // Paging to the next month keeps this month on screen until it arrives.
    placeholderData: keepPreviousData,
  });
  const filters = useQuery({
    queryKey: hrCalendarKeys.filters,
    queryFn: getHrCalendarFilters,
  });

  const entries = useMemo(
    () =>
      (calendar.data?.entries ?? []).filter(
        (entry) => !hidden.has(layerOf(entry)),
      ),
    [calendar.data, hidden],
  );
  const holidayPolicies = calendar.data?.holidayPolicies ?? [];
  const managesEvents = calendar.data?.viewer.managesEvents ?? false;

  const editing = overlay?.kind === "event" ? overlay.eventId : null;
  const event = useQuery({
    queryKey: hrCalendarKeys.event(editing ?? ""),
    queryFn: () => getAgencyEvent(editing!),
    enabled: editing !== null,
  });

  const toggle = (layer: CalendarLayer) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });

  const openEntry = (entry: HrCalendarEntry) =>
    setOverlay(
      entry.kind === "leave" && entry.detail
        ? { kind: "request", requestId: entry.detail.requestId }
        : { kind: "entry", entry },
    );
  const openEventForm = (eventId: string | null, picked?: CalendarRange) =>
    setOverlay({ kind: "event", eventId, range: picked });

  return (
    <SettingsPage
      title="Calendar"
      caption="HR"
      icon={CalendarDays}
      backTo="/"
      width="wide"
    >
      {/* Breathing room: the grid sits inside the page, not on its edges. */}
      <div className="mx-auto max-w-7xl space-y-4 pb-6 sm:px-2">
        <CalendarToolbar
          hidden={hidden}
          onToggle={toggle}
          filters={filters.data}
          branchIds={filter.branch}
          employeeIds={filter.employee}
          onFilter={setFilter}
        />

        {calendar.isError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              Could not load the calendar. Try again.
            </AlertDescription>
          </Alert>
        )}

        <HrCalendar
          entries={entries}
          today={today}
          compact={compact}
          onRangeChange={(next) =>
            setRange((current) =>
              current?.from === next.from && current.to === next.to
                ? current
                : next,
            )
          }
          onEntryClick={openEntry}
          onDayPick={
            compact ? (date) => setOverlay({ kind: "day", date }) : undefined
          }
          onAdd={
            managesEvents ? (picked) => openEventForm(null, picked) : undefined
          }
        />
      </div>

      {overlay?.kind === "day" && (
        <DaySheet
          date={overlay.date}
          entries={entries}
          onClose={() => setOverlay(null)}
          onEntryClick={openEntry}
          onAdd={
            managesEvents
              ? () =>
                  openEventForm(null, { from: overlay.date, to: overlay.date })
              : undefined
          }
        />
      )}
      {overlay?.kind === "entry" && (
        <EntrySheet
          entry={overlay.entry}
          holidayPolicies={holidayPolicies}
          onClose={() => setOverlay(null)}
          onEditEvent={
            managesEvents
              ? (eventId: string) => openEventForm(eventId)
              : undefined
          }
        />
      )}
      {overlay?.kind === "request" && (
        <RequestViewSheet
          key={overlay.requestId}
          requestId={overlay.requestId}
          onClose={() => setOverlay(null)}
          onEdit={(request) => setOverlay({ kind: "editRequest", request })}
        />
      )}
      {overlay?.kind === "editRequest" && (
        <RequestSheet
          key={overlay.request.id}
          mode="self"
          request={overlay.request}
          onClose={() => setOverlay(null)}
          onSaved={(saved) =>
            setOverlay({ kind: "request", requestId: saved.id })
          }
        />
      )}
      {overlay?.kind === "event" &&
        (overlay.eventId === null || event.data) && (
          <EventSheet
            // Remounted per event: the audience lists are array fields.
            key={overlay.eventId ?? "new"}
            event={overlay.eventId === null ? null : (event.data ?? null)}
            range={overlay.range}
            onClose={() => setOverlay(null)}
          />
        )}
    </SettingsPage>
  );
}
