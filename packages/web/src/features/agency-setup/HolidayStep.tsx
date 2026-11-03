import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addCalendarDays,
  getAgencyCalendar,
  getHolidayRegions,
  getHolidaySuggestions,
  hrKeys,
  updateAgencyCalendar,
} from "@/lib/hr-api";
import { hrErrorMessage } from "@/features/hr/settings/hr-error";
import {
  defaultHolidayPickerValue,
  HolidayPicker,
  holidayPickerDays,
  type HolidayPickerValue,
} from "@/features/hr/settings/calendar/HolidayPicker";
import { RegionPicker } from "@/features/hr/settings/calendar/RegionPicker";
import { useStepContinue } from "./AgencySetupSteps";

/**
 * The holiday step of the owner's first-run setup (PAC-161, epic §1).
 *
 * A list, not the settings calendar: the owner ticks the days the office
 * closes this year — federal holidays ticked, the state's and other
 * observances not, custom closures by hand — in the same `HolidayPicker` the
 * settings import dialog uses. The country and region arrive pre-filled from
 * the branch address and can be changed on the line above the list (saved at
 * once, like the time zone). Continue writes the ticked set in one
 * `POST /hr/calendar/days` as `onboarding` rows; with nothing ticked it writes
 * nothing. Skip writes nothing and records `calendarSkipped`. An owner coming
 * back through `/welcome/agency` sees rows already on the calendar ticked and
 * disabled. Next year is not offered: the Q4 job proposes it.
 */
export function HolidayStep() {
  const queryClient = useQueryClient();
  const year = new Date().getFullYear();

  const calendarQuery = useQuery({
    queryKey: hrKeys.calendar(year),
    queryFn: () => getAgencyCalendar(year),
  });
  const country = calendarQuery.data?.country ?? null;
  const region = calendarQuery.data?.region ?? null;
  const workweek = calendarQuery.data?.workweek ?? [];

  const regionsQuery = useQuery({
    queryKey: hrKeys.regions(country),
    queryFn: () => getHolidayRegions(country),
    enabled: country !== null,
  });
  const countryName =
    regionsQuery.data?.countries.find((c) => c.code === country)?.name ?? country;
  const regionName =
    regionsQuery.data?.regions.find((r) => r.code === region)?.name ?? region;

  const suggestionsQuery = useQuery({
    queryKey: ["hr", "suggestions", country, region, year] as const,
    queryFn: () => getHolidaySuggestions({ country: country!, region, year }),
    enabled: country !== null,
  });
  const suggestions = suggestionsQuery.data?.suggestions;

  const [value, setValue] = useState<HolidayPickerValue>({ ticked: [], custom: [] });
  useEffect(() => {
    if (suggestions) setValue(defaultHolidayPickerValue(suggestions));
  }, [suggestions]);

  const [editingRegion, setEditingRegion] = useState(false);
  const saveRegion = useMutation({
    mutationFn: (next: { country: string | null; region: string | null }) =>
      updateAgencyCalendar(next),
    onSuccess: (next) => {
      queryClient.setQueryData(hrKeys.calendar(year), next);
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  const addDays = useMutation({
    mutationFn: (days: ReturnType<typeof holidayPickerDays>) =>
      addCalendarDays({ source: "onboarding", days }),
  });

  const handler = useCallback(async () => {
    if (!suggestions) return true;
    const days = holidayPickerDays(value, suggestions, workweek);
    if (days.length === 0) return true;
    try {
      const result = await addDays.mutateAsync(days);
      void queryClient.invalidateQueries({ queryKey: ["hr", "calendar"] });
      toast.success(
        `${result.days.length} holiday${result.days.length === 1 ? "" : "s"} added for ${year}.`,
      );
      return true;
    } catch (error) {
      toast.error(hrErrorMessage(error));
      return false;
    }
  }, [addDays, queryClient, suggestions, value, workweek, year]);

  useStepContinue(handler, addDays.isPending || saveRegion.isPending);

  const alreadyOn = suggestions?.filter((s) => s.alreadyInCalendar).length ?? 0;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">Holidays for {year} in</span>
          <span className="text-foreground">
            {country ? [countryName, regionName].filter(Boolean).join(" · ") : "no country yet"}
          </span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => setEditingRegion((on) => !on)}
          >
            {editingRegion ? "Done" : "Change"}
          </Button>
        </div>
        {editingRegion && (
          <RegionPicker
            country={country}
            region={region}
            disabled={calendarQuery.isPending || saveRegion.isPending}
            onChange={(next) => saveRegion.mutate(next)}
          />
        )}
      </div>

      {calendarQuery.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : calendarQuery.isError ? (
        <p className="text-sm text-destructive">{hrErrorMessage(calendarQuery.error)}</p>
      ) : !country ? (
        <p className="text-sm text-muted-foreground">
          Choose a country to see its holidays, or skip this and add them later under
          Settings → HR.
        </p>
      ) : suggestionsQuery.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : suggestionsQuery.isError ? (
        <p className="text-sm text-destructive">{hrErrorMessage(suggestionsQuery.error)}</p>
      ) : suggestions ? (
        <>
          <p className="text-sm text-muted-foreground">
            Federal holidays are ticked. Untick any the office stays open for, tick any
            others it closes for, and add your own closures.
            {alreadyOn > 0 &&
              ` ${alreadyOn} ${alreadyOn === 1 ? "is" : "are"} already on your calendar.`}
          </p>
          <HolidayPicker
            items={suggestions}
            workweek={workweek}
            year={year}
            value={value}
            onChange={setValue}
            disabled={addDays.isPending}
          />
        </>
      ) : null}
    </div>
  );
}
