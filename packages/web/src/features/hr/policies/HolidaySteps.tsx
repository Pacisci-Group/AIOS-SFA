import { useState } from "react";
import { useStore } from "@tanstack/react-form";
import { Trash2 } from "lucide-react";
import { z } from "zod";
import {
  addIsoDays,
  customHolidayError,
  CUSTOM_HOLIDAYS_MAX,
  HOLIDAY_CATALOG,
  HOLIDAY_NAME_MAX_LENGTH,
  holidaysInYear,
  nextHolidayInstance,
  type CustomHoliday,
  type HolidayGroup,
  type HolidayKey,
} from "@sfa/shared";
import { FormError, FormGrid } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppForm } from "@/hooks/form";
import { formatDay, formatRange, todayIso } from "./policy-display";

/**
 * The holiday half of the policy wizard (PAC-161 v3): a plain list of
 * holidays to tick — no calendar — each with the next day it closes the
 * office. Step 1 is the eleven federal holidays (ticked for a new policy),
 * step 2 the common extras and the agency's own.
 */

export function HolidayChecklist({
  group,
  selected,
  onChange,
}: {
  group: HolidayGroup;
  selected: readonly HolidayKey[];
  onChange: (next: HolidayKey[]) => void;
}) {
  const today = todayIso();
  const rows = HOLIDAY_CATALOG.filter((holiday) => holiday.group === group);
  const chosen = new Set(selected);
  const allOn = rows.every((row) => chosen.has(row.key));

  const toggle = (key: HolidayKey, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(key);
    else next.delete(key);
    // Catalog order, so the stored list reads the same however it was ticked.
    onChange(HOLIDAY_CATALOG.map((h) => h.key).filter((k) => next.has(k)));
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h3 className="text-base font-semibold text-card-foreground">
          {group === "federal" ? "Federal holidays" : "Popular additions"}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            const keys = new Set(chosen);
            for (const row of rows) {
              if (allOn) keys.delete(row.key);
              else keys.add(row.key);
            }
            onChange(HOLIDAY_CATALOG.map((h) => h.key).filter((k) => keys.has(k)));
          }}
        >
          {allOn ? "Clear all" : "Select all"}
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const next = nextHolidayInstance(row.key, today);
          const id = `holiday-${row.key}`;
          return (
            <li key={row.key}>
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-accent/40"
              >
                <Checkbox
                  id={id}
                  checked={chosen.has(row.key)}
                  onCheckedChange={(checked) => toggle(row.key, checked === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-base">{row.name}</span>
                  <span className="block text-xs text-muted-foreground">{row.when}</span>
                </span>
                <span className="text-right">
                  <span className="block text-sm tabular-nums">{formatDay(next.date)}</span>
                  {next.observedFor && (
                    <span className="block text-xs text-muted-foreground">
                      Observed — falls on a weekend
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CustomHolidaysEditor({
  value,
  onChange,
}: {
  value: readonly CustomHoliday[];
  onChange: (next: CustomHoliday[]) => void;
}) {
  // Re-seeded by remount after each Add, so the form starts empty again.
  const [seed, setSeed] = useState(0);
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-base font-semibold text-card-foreground">Your own holidays</h3>
        <p className="text-sm text-muted-foreground">
          A company day, a winter closure — one day or a range of days.
        </p>
      </div>
      {value.length > 0 && (
        <ul className="divide-y divide-border border-b border-border">
          {value.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-base">{row.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatRange(row.start, row.end)}
                  {row.repeatsYearly ? ", every year" : `, ${row.start.slice(0, 4)} only`}
                </span>
              </span>
              {row.repeatsYearly && <Badge variant="outline">Every year</Badge>}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${row.name}`}
                onClick={() => onChange(value.filter((other) => other.id !== row.id))}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="px-5 py-4">
        {value.length >= CUSTOM_HOLIDAYS_MAX ? (
          <p className="text-sm text-muted-foreground">
            That is the most custom holidays a policy can hold.
          </p>
        ) : (
          <CustomHolidayForm
            key={seed}
            onAdd={(row) => {
              onChange([...value, row]);
              setSeed((s) => s + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}

const customHolidaySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the holiday a name.")
    .max(HOLIDAY_NAME_MAX_LENGTH, `Keep it under ${HOLIDAY_NAME_MAX_LENGTH} characters.`),
  start: z.string().min(1, "Choose a date."),
  // Empty means a single day.
  end: z.string(),
  repeatsYearly: z.boolean(),
});
type CustomHolidayValues = z.infer<typeof customHolidaySchema>;

function CustomHolidayForm({ onAdd }: { onAdd: (row: CustomHoliday) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: {
      name: "",
      start: "",
      end: "",
      repeatsYearly: true,
    } as CustomHolidayValues,
    validators: { onBlur: customHolidaySchema },
    onSubmit: ({ value }) => {
      const row = {
        name: value.name.trim(),
        start: value.start,
        end: value.end || value.start,
      };
      const error = customHolidayError(row);
      if (error) return setProblem(error);
      setProblem(null);
      onAdd({
        ...row,
        id: `custom-${Date.now().toString(36)}`,
        repeatsYearly: value.repeatsYearly,
      });
    },
  });

  const span = useStore(form.store, (state) => {
    const { start } = state.values;
    const end = state.values.end || start;
    if (!start || customHolidayError({ name: "x", start, end })) return null;
    const days =
      Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
    return `${days} day${days === 1 ? "" : "s"}`;
  });

  return (
    <form.AppForm>
      <div className="space-y-3">
        <FormGrid columns={3} gap={3}>
          <form.AppField name="name">
            {(f) => (
              <f.TextField label="Name" placeholder="Winter closure" autoComplete="off" />
            )}
          </form.AppField>
          <form.AppField name="start">
            {(f) => <f.TextField label="Date" type="date" />}
          </form.AppField>
          <form.AppField name="end">
            {(f) => (
              <f.TextField label="Until" description="Optional, for a range." type="date" />
            )}
          </form.AppField>
        </FormGrid>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form.AppField name="repeatsYearly">
            {(f) => <f.CheckboxField label="Repeats every year" />}
          </form.AppField>
          <div className="flex items-center gap-3">
            {span && <span className="text-xs text-muted-foreground">{span}</span>}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void form.handleSubmit()}
            >
              Add holiday
            </Button>
          </div>
        </div>
        <FormError>{problem}</FormError>
      </div>
    </form.AppForm>
  );
}

/** The whole year at a glance, as a list: what step 2 adds up to. */
export function HolidayYearSummary({
  holidays,
  customHolidays,
}: {
  holidays: readonly HolidayKey[];
  customHolidays: readonly CustomHoliday[];
}) {
  const year = Number(todayIso().slice(0, 4));
  const days = holidaysInYear({ holidays, customHolidays }, year);
  // A multi-day custom holiday reads as one row, "Dec 28 – Dec 31".
  const rows: { key: string; name: string; label: string }[] = [];
  for (let i = 0; i < days.length; i += 1) {
    const start = days[i];
    let j = i;
    while (
      start.customId &&
      j + 1 < days.length &&
      days[j + 1].customId === start.customId &&
      days[j + 1].date === addIsoDays(days[j].date, 1)
    ) {
      j += 1;
    }
    rows.push({
      key: start.date,
      name: start.name,
      label: j > i ? formatRange(start.date, days[j].date) : formatDay(start.date),
    });
    i = j;
  }
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-base font-semibold text-card-foreground">
          {days.length} day{days.length === 1 ? "" : "s"} off in {year}
        </h3>
      </div>
      {days.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No holidays chosen yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 px-5 py-2">
              <span className="text-sm">{row.name}</span>
              <span className="text-sm tabular-nums text-muted-foreground">{row.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
