import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { AgencyCalendarDayView } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getAgencyCalendar, hrKeys } from "@/lib/hr-api";
import { hrErrorMessage } from "../hr-error";
import { CalendarDayDialog } from "./CalendarDayDialog";
import { HolidayImportDialog } from "./HolidayImportDialog";
import { ProposalBanner } from "./ProposalBanner";
import { WorkweekCard } from "./WorkweekCard";
import { YearGrid } from "./YearGrid";

interface CalendarTabProps {
  canWrite: boolean;
  /** The year a notification deep-linked to, so its proposal opens for review. */
  proposalYear?: number | null;
}

/**
 * The calendar side of `/settings/hr` (PAC-161): the working week, the year
 * grid, the import dialog and any pending Q4 proposal. Also the body of the
 * onboarding Calendar step, with `canWrite` always true there.
 */
export function CalendarTab({ canWrite, proposalYear = null }: CalendarTabProps) {
  const [year, setYear] = useState(() => proposalYear ?? new Date().getFullYear());
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState<{
    date: string;
    existing: AgencyCalendarDayView | null;
  } | null>(null);

  const query = useQuery({
    queryKey: hrKeys.calendar(year),
    queryFn: () => getAgencyCalendar(year),
  });

  if (query.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (query.isError) {
    return <p className="text-sm text-destructive">{hrErrorMessage(query.error)}</p>;
  }
  const calendar = query.data;

  return (
    <div className="space-y-5">
      {calendar.pendingProposal && canWrite && (
        <ProposalBanner
          proposal={calendar.pendingProposal}
          openReview={proposalYear === calendar.pendingProposal.year}
        />
      )}

      <WorkweekCard calendar={calendar} canWrite={canWrite} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Previous year"
              onClick={() => setYear((y) => y - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <h2 className="min-w-16 text-center text-sm font-semibold tabular-nums">{year}</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Next year"
              onClick={() => setYear((y) => y + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          {canWrite && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!calendar.country}
              title={calendar.country ? undefined : "Choose a country first"}
              onClick={() => setImporting(true)}
            >
              <Download className="size-4" />
              Import holidays for {year}
            </Button>
          )}
        </div>

        {calendar.days.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No holidays or closures for {year} yet.
            {canWrite
              ? " Import the public holidays, or click a day to add one."
              : ""}
          </p>
        )}

        <YearGrid
          year={year}
          workweek={calendar.workweek}
          days={calendar.days}
          workingDaysByMonth={calendar.workingDaysByMonth}
          onPickDay={canWrite ? (date, existing) => setPicked({ date, existing }) : undefined}
        />
      </section>

      <HolidayImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        country={calendar.country}
        region={calendar.region}
        year={year}
        source="import"
      />
      <CalendarDayDialog
        year={year}
        date={picked?.date ?? null}
        existing={picked?.existing ?? null}
        onClose={() => setPicked(null)}
      />
    </div>
  );
}
