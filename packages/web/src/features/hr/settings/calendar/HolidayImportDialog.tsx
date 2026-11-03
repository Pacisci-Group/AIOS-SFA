import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { HolidaySuggestion } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { addCalendarDays, getHolidaySuggestions, hrKeys } from "@/lib/hr-api";
import { hrErrorMessage } from "../hr-error";
import { formatIsoDate } from "./calendar-display";

interface HolidayImportDialogProps {
  open: boolean;
  onClose: () => void;
  country: string | null;
  region: string | null;
  year: number;
  /** `onboarding` in the wizard, `import` in settings — both carry no reason. */
  source: "import" | "onboarding";
}

/**
 * "Import holidays for YEAR" (PAC-161): what `date-holidays` suggests for the
 * agency's country and region, public holidays ticked, the rest not. Nothing
 * is written until Import — the whole point of suggestions is that a person
 * decides.
 */
export function HolidayImportDialog({
  open,
  onClose,
  country,
  region,
  year,
  source,
}: HolidayImportDialogProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hr", "suggestions", country, region, year] as const,
    queryFn: () => getHolidaySuggestions({ country: country!, region, year }),
    enabled: open && country !== null,
  });

  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!query.data) return;
    setTicked(
      new Set(
        query.data.suggestions
          .filter((s) => s.preChecked && !s.alreadyInCalendar)
          .map((s) => s.date),
      ),
    );
  }, [query.data]);

  const groups = useMemo(() => {
    const list = query.data?.suggestions ?? [];
    return {
      publicHolidays: list.filter((s) => s.type === "public"),
      others: list.filter((s) => s.type !== "public"),
    };
  }, [query.data]);

  const importDays = useMutation({
    mutationFn: () =>
      addCalendarDays({
        source,
        days: (query.data?.suggestions ?? [])
          .filter((s) => ticked.has(s.date))
          .map((s) => ({ date: s.date, kind: "holiday" as const, label: s.name })),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: hrKeys.calendar(year) });
      toast.success(
        `${result.days.length} holiday${result.days.length === 1 ? "" : "s"} added for ${year}.`,
      );
      onClose();
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  const toggle = (date: string, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(date);
      else next.delete(date);
      return next;
    });

  const row = (s: HolidaySuggestion) => {
    const id = `hr-suggest-${s.date}`;
    return (
      <li key={`${s.date}-${s.name}`} className="flex items-start gap-3 py-1.5">
        <Checkbox
          id={id}
          checked={s.alreadyInCalendar || ticked.has(s.date)}
          disabled={s.alreadyInCalendar}
          onCheckedChange={(checked) => toggle(s.date, checked === true)}
          className="mt-0.5"
        />
        <Label htmlFor={id} className="grid gap-0.5 font-normal">
          <span className="text-sm text-foreground">
            {s.name}
            {s.substitute && (
              <span className="ml-1 text-xs text-muted-foreground">(observed)</span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatIsoDate(s.date)}
            {s.alreadyInCalendar ? " · already on the calendar" : ""}
            {s.type !== "public" ? ` · ${s.type}` : ""}
          </span>
        </Label>
      </li>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import holidays for {year}</DialogTitle>
          <DialogDescription>
            {country
              ? "Public holidays are ticked. Untick any the office stays open for, and tick any observances it closes for."
              : "Choose a country in Working week first."}
          </DialogDescription>
        </DialogHeader>

        {country && query.isPending ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : query.isError ? (
          <p className="text-sm text-destructive">{hrErrorMessage(query.error)}</p>
        ) : query.data ? (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Public holidays
              </h3>
              <ul className="divide-y divide-border">{groups.publicHolidays.map(row)}</ul>
            </section>
            {groups.others.length > 0 && (
              <section>
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Other observances
                </h3>
                <ul className="divide-y divide-border">{groups.others.map(row)}</ul>
              </section>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={importDays.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={!query.data || ticked.size === 0 || importDays.isPending}
            onClick={() => importDays.mutate()}
          >
            {importDays.isPending ? "Importing…" : `Import ${ticked.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
