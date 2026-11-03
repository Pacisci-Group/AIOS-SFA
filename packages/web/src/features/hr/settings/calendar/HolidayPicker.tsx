import { useMemo, useState } from "react";
import { useStore } from "@tanstack/react-form";
import { X } from "lucide-react";
import { z } from "zod";
import {
  expandHolidayRange,
  HOLIDAY_NAME_MAX_LENGTH,
  holidayRangeError,
  type AddCalendarDayInput,
  type HolidaySuggestionGroup,
  type HolidaySuggestionType,
  type Weekday,
  WEEKDAY_LABELS,
} from "@sfa/shared";
import { FormError, FormGrid } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAppForm } from "@/hooks/form";
import { cn } from "@/lib/utils";
import { formatIsoDate, MONTH_NAMES, weekdayOf } from "./calendar-display";

/**
 * One suggestion row as every host has it: `HolidaySuggestion` from the
 * import endpoint, or a `HolidayProposalItemView` from a Q4 proposal (which
 * has no `alreadyInCalendar`).
 */
export interface HolidayPickerItem {
  date: string;
  name: string;
  type: HolidaySuggestionType;
  substitute: boolean;
  group: HolidaySuggestionGroup;
  preChecked: boolean;
  alreadyInCalendar?: boolean;
}

/** A custom all-day range the person added; expanded to rows on save. */
export interface CustomHoliday {
  /** Client-side only, for the remove button. */
  id: string;
  name: string;
  /** `YYYY-MM-DD`, inclusive. */
  start: string;
  end: string;
}

export interface HolidayPickerValue {
  /** Dates of the ticked suggestions. */
  ticked: string[];
  custom: CustomHoliday[];
}

interface HolidayPickerProps {
  items: readonly HolidayPickerItem[];
  /** The agency workweek: a custom range is written on these days only. */
  workweek: readonly Weekday[];
  /** The year the list is for; a custom range starts in it. */
  year: number;
  value: HolidayPickerValue;
  onChange: (next: HolidayPickerValue) => void;
  /** Hidden on the Q4 proposal review, which confirms a fixed list. */
  allowCustom?: boolean;
  disabled?: boolean;
  /** Scroll container height; the dialogs cap it, the wizard step does not. */
  className?: string;
}

/** The default selection: the pre-checked rows not already on the calendar. */
export function defaultHolidayPickerValue(
  items: readonly HolidayPickerItem[],
): HolidayPickerValue {
  return {
    ticked: items
      .filter((item) => item.preChecked && !item.alreadyInCalendar)
      .map((item) => item.date),
    custom: [],
  };
}

/**
 * What the host writes: the ticked suggestions as `holiday` rows plus each
 * custom range expanded to its workweek days, one row per date, sorted.
 */
export function holidayPickerDays(
  value: HolidayPickerValue,
  items: readonly HolidayPickerItem[],
  workweek: readonly Weekday[],
): AddCalendarDayInput[] {
  const ticked = new Set(value.ticked);
  const days: AddCalendarDayInput[] = items
    .filter((item) => ticked.has(item.date) && !item.alreadyInCalendar)
    .map((item) => ({ date: item.date, kind: "holiday", label: item.name }));
  for (const range of value.custom) {
    for (const date of expandHolidayRange(range.start, range.end, workweek)) {
      days.push({ date, kind: "holiday", label: range.name });
    }
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

const SECTION_TITLES: Record<HolidaySuggestionGroup, string> = {
  federal: "Federal holidays",
  other: "Other holidays",
};

/**
 * The three-section holiday picker (PAC-161 v2): federal holidays ticked,
 * other holidays unticked, and custom all-day ranges — the same list in the
 * owner's setup step, the "Import holidays for YEAR" dialog and the Q4
 * proposal review, so one idea of what the agency is choosing. Controlled:
 * nothing is written here; each host decides when.
 */
export function HolidayPicker({
  items,
  workweek,
  year,
  value,
  onChange,
  allowCustom = true,
  disabled = false,
  className,
}: HolidayPickerProps) {
  const ticked = useMemo(() => new Set(value.ticked), [value.ticked]);
  const sections = useMemo(
    () =>
      (["federal", "other"] as const)
        .map((group) => ({
          group,
          rows: items.filter((item) => item.group === group),
        }))
        .filter((section) => section.rows.length > 0),
    [items],
  );

  const toggle = (date: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(date);
    else next.delete(date);
    onChange({ ...value, ticked: [...next] });
  };

  /** Every date a new custom range may not land on. */
  const taken = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.alreadyInCalendar || ticked.has(item.date)) {
        map.set(item.date, item.name);
      }
    }
    for (const range of value.custom) {
      for (const date of expandHolidayRange(range.start, range.end, workweek)) {
        map.set(date, range.name);
      }
    }
    return map;
  }, [items, ticked, value.custom, workweek]);

  return (
    <div className={cn("space-y-4", className)}>
      {sections.map((section) => (
        <section key={section.group}>
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {SECTION_TITLES[section.group]}
          </h3>
          <ul className="divide-y divide-border">
            {section.rows.map((item) => (
              <SuggestionRow
                key={item.date}
                item={item}
                checked={item.alreadyInCalendar === true || ticked.has(item.date)}
                disabled={disabled || item.alreadyInCalendar === true}
                onCheckedChange={(on) => toggle(item.date, on)}
              />
            ))}
          </ul>
        </section>
      ))}

      {allowCustom && (
        <section className="space-y-2">
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Custom holidays
          </h3>
          {value.custom.length > 0 && (
            <ul className="divide-y divide-border">
              {value.custom.map((range) => (
                <CustomRow
                  key={range.id}
                  range={range}
                  workweek={workweek}
                  disabled={disabled}
                  onRemove={() =>
                    onChange({
                      ...value,
                      custom: value.custom.filter((r) => r.id !== range.id),
                    })
                  }
                />
              ))}
            </ul>
          )}
          {!disabled && (
            <CustomHolidayForm
              year={year}
              workweek={workweek}
              taken={taken}
              onAdd={(range) => onChange({ ...value, custom: [...value.custom, range] })}
            />
          )}
        </section>
      )}
    </div>
  );
}

function SuggestionRow({
  item,
  checked,
  disabled,
  onCheckedChange,
}: {
  item: HolidayPickerItem;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  const id = `hr-pick-${item.date}`;
  // The one federal row offered unticked is the weekend original of a
  // substitute pair (see `groupHolidaySuggestions`).
  const weekendOriginal =
    item.group === "federal" && !item.substitute && !item.preChecked;
  const notes: string[] = [formatIsoDate(item.date)];
  if (item.alreadyInCalendar) notes.push("already on the calendar");
  if (weekendOriginal) notes.push(`falls on a ${weekdayName(item.date)}`);
  if (item.group === "other" && item.type !== "public") notes.push(item.type);
  return (
    <li className="flex items-start gap-3 py-1.5">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(state) => onCheckedChange(state === true)}
        className="mt-0.5"
      />
      <Label htmlFor={id} className="grid gap-0.5 font-normal">
        <span className="text-sm text-foreground">
          {item.name}
          {item.substitute && (
            <span className="ml-1 text-xs text-muted-foreground">(observed)</span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{notes.join(" · ")}</span>
      </Label>
    </li>
  );
}

function CustomRow({
  range,
  workweek,
  disabled,
  onRemove,
}: {
  range: CustomHoliday;
  workweek: readonly Weekday[];
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-start gap-3 py-1.5">
      <Checkbox checked disabled className="mt-0.5" aria-label={range.name} />
      <span className="grid flex-1 gap-0.5">
        <span className="text-sm text-foreground">{range.name}</span>
        <span className="text-xs text-muted-foreground">
          {describeRange(range.start, range.end, workweek)}
        </span>
      </span>
      {!disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${range.name}`}
          onClick={onRemove}
        >
          <X className="size-4" />
        </Button>
      )}
    </li>
  );
}

const customHolidaySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the holiday a name")
    .max(HOLIDAY_NAME_MAX_LENGTH, `At most ${HOLIDAY_NAME_MAX_LENGTH} characters`),
  start: z.string().min(1, "Choose a start date"),
  // Empty means a single day; the range rules run on Add.
  end: z.string(),
});

type CustomHolidayValues = z.infer<typeof customHolidaySchema>;

/**
 * Name, start, end, Add. The range rules (`holidayRangeError`, the year, a
 * collision with a ticked or stored day) are checked on Add rather than per
 * field, because each needs both dates and the rest of the picker.
 */
function CustomHolidayForm({
  year,
  workweek,
  taken,
  onAdd,
}: {
  year: number;
  workweek: readonly Weekday[];
  taken: ReadonlyMap<string, string>;
  onAdd: (range: CustomHoliday) => void;
}) {
  // Re-seeded by remount after each Add (the array-field reset trap does not
  // bite three scalars, but one idiom for every form is worth more).
  const [seed, setSeed] = useState(0);
  return (
    <CustomHolidayFields
      key={seed}
      year={year}
      workweek={workweek}
      taken={taken}
      onAdd={(range) => {
        onAdd(range);
        setSeed((s) => s + 1);
      }}
    />
  );
}

function CustomHolidayFields({
  year,
  workweek,
  taken,
  onAdd,
}: {
  year: number;
  workweek: readonly Weekday[];
  taken: ReadonlyMap<string, string>;
  onAdd: (range: CustomHoliday) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: { name: "", start: "", end: "" } as CustomHolidayValues,
    validators: { onBlur: customHolidaySchema },
    onSubmit: ({ value }) => {
      const start = value.start;
      const end = value.end || value.start;
      const error = holidayRangeError(start, end);
      if (error) return setProblem(error);
      if (!start.startsWith(`${year}-`)) {
        return setProblem(`The holiday must start in ${year}.`);
      }
      const days = expandHolidayRange(start, end, workweek);
      if (days.length === 0) {
        return setProblem("No working day falls in that range.");
      }
      const clash = days.find((date) => taken.has(date));
      if (clash) {
        return setProblem(
          `${formatIsoDate(clash)} is already ${taken.get(clash)}.`,
        );
      }
      setProblem(null);
      onAdd({
        id: `${start}:${end}:${Date.now()}`,
        name: value.name.trim(),
        start,
        end,
      });
    },
  });

  const summary = useStore(form.store, (state) => {
    const start = state.values.start;
    const end = state.values.end || start;
    if (!start || holidayRangeError(start, end)) return null;
    return describeRange(start, end, workweek);
  });

  return (
    <form.AppForm>
      <div className="space-y-2 rounded-lg border border-border bg-sunken/40 p-3">
        <FormGrid>
          <form.AppField name="name">
            {(f) => (
              <f.TextField
                label="Name"
                placeholder="Winter closure"
                autoComplete="off"
                className="sm:col-span-2"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="start">
            {(f) => (
              <f.TextField
                label="From"
                type="date"
                min={`${year}-01-01`}
                max={`${year}-12-31`}
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="end">
            {(f) => (
              <f.TextField
                label="To"
                description="Leave empty for a single day."
                type="date"
                min={`${year}-01-01`}
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
        </FormGrid>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{summary ?? ""}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void form.handleSubmit()}
          >
            Add holiday
          </Button>
        </div>
        <FormError>{problem}</FormError>
      </div>
    </form.AppForm>
  );
}

function weekdayName(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAY_LABELS[weekdayOf(y, m, d)];
}

function shortDay(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}${withYear ? ` ${y}` : ""}`;
}

/** `'24 Dec – 2 Jan 2027 · 6 working days'`. */
export function describeRange(
  start: string,
  end: string,
  workweek: readonly Weekday[],
): string {
  const count = expandHolidayRange(start, end, workweek).length;
  const days = `${count} working day${count === 1 ? "" : "s"}`;
  if (start === end) return `${shortDay(start, true)} · ${days}`;
  const crossesYear = start.slice(0, 4) !== end.slice(0, 4);
  return `${shortDay(start, crossesYear)} – ${shortDay(end, true)} · ${days}`;
}
