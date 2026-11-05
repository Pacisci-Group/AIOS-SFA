import {
  TIME_OFF_DAY_MODES,
  TIME_OFF_HOURS_STEP,
  TIME_OFF_NOTE_MAX_LENGTH,
  type RecordTimeOffInput,
  type TimeOffDayMode,
  type TimeOffRequestInput,
  type TimeOffRequestView,
} from "@sfa/shared";
import { z } from "zod";

/**
 * The request form (PAC-165): the four inputs of a request — policy, dates,
 * full or partial days, note — and, when time off is recorded for someone
 * else, who it is for.
 *
 * The schema checks what the browser can know: a first day, a last day not
 * before it, hours that are numbers. Everything that needs the server — the
 * person's schedule, their balance, an overlap — comes back from the
 * preview as the form is filled in, and is the server's to refuse.
 *
 * Dates are `YYYY-MM-DD` strings (what `<input type="date">` holds), and
 * "today" is the **agency's** day, the day the API judges on.
 *
 * `hours` is an **object keyed by date**, never an array field: the rows
 * come and go as the dates change, and a TanStack array field ignores
 * `form.reset` (see `docs/tanstack-form-spike-findings.md`). Values stay
 * strings, as every number input's does.
 */

export type RequestFormMode = "self" | "record";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: string): boolean {
  return ISO_DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function requestFormSchema(today: string, mode: RequestFormMode) {
  return z
    .object({
      employeeId: z.string(),
      policyId: z.string(),
      firstDay: z.string(),
      lastDay: z.string(),
      dayMode: z.enum(TIME_OFF_DAY_MODES),
      hours: z.record(z.string(), z.string()),
      note: z
        .string()
        .max(TIME_OFF_NOTE_MAX_LENGTH, `Keep it under ${TIME_OFF_NOTE_MAX_LENGTH} characters.`),
    })
    .superRefine((values, ctx) => {
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: "custom", path, message });

      if (mode === "record" && !values.employeeId) {
        issue(["employeeId"], "Choose who the time off is for.");
      }
      if (!values.policyId) issue(["policyId"], "Choose a time off policy.");
      if (!isIsoDay(values.firstDay)) {
        issue(["firstDay"], "Choose the first day.");
      } else if (mode === "self" && values.firstDay < today) {
        issue(["firstDay"], "Your own time off starts today or later.");
      }
      if (!isIsoDay(values.lastDay)) {
        issue(["lastDay"], "Choose the last day.");
      } else if (isIsoDay(values.firstDay) && values.lastDay < values.firstDay) {
        issue(["lastDay"], "The last day cannot be before the first day.");
      }
      if (values.dayMode === "partial") {
        for (const [date, typed] of Object.entries(values.hours)) {
          if (typed.trim() === "") continue;
          const hours = Number(typed);
          if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
            issue(["hours", date], "Enter hours between 0 and 24.");
          } else if (!Number.isInteger(Math.round((hours / TIME_OFF_HOURS_STEP) * 100) / 100)) {
            issue(["hours", date], "Use quarter hours.");
          }
        }
      }
    });
}

export interface RequestFormValues {
  employeeId: string;
  policyId: string;
  firstDay: string;
  lastDay: string;
  dayMode: TimeOffDayMode;
  hours: Record<string, string>;
  note: string;
}

/** A blank form for `policyId`, or the saved request being edited. */
export function requestFormDefaults(seed: {
  policyId?: string;
  employeeId?: string;
  request?: TimeOffRequestView | null;
}): RequestFormValues {
  const { request } = seed;
  if (request) {
    return {
      employeeId: request.employee?.id ?? "",
      policyId: request.policy?.id ?? "",
      firstDay: request.firstDay ?? "",
      lastDay: request.lastDay ?? "",
      dayMode: request.dayMode ?? "full",
      hours:
        request.dayMode === "partial"
          ? Object.fromEntries(
              request.days
                .filter((day) => day.scheduledHours > 0)
                .map((day) => [day.date, String(day.hours)]),
            )
          : {},
      note: request.note ?? "",
    };
  }
  return {
    employeeId: seed.employeeId ?? "",
    policyId: seed.policyId ?? "",
    firstDay: "",
    lastDay: "",
    dayMode: "full",
    hours: {},
    note: "",
  };
}

/** Whether the form holds enough for the server to work out the hours. */
export function previewable(values: RequestFormValues, mode: RequestFormMode): boolean {
  return (
    Boolean(values.policyId) &&
    (mode === "self" || Boolean(values.employeeId)) &&
    isIsoDay(values.firstDay) &&
    isIsoDay(values.lastDay) &&
    values.firstDay <= values.lastDay
  );
}

/** The API's inputs from the form: typed hours as numbers, inside the range, on Partial days only. */
export function toRequestInput(values: RequestFormValues): TimeOffRequestInput {
  const hours: Record<string, number> = {};
  if (values.dayMode === "partial") {
    for (const [date, typed] of Object.entries(values.hours)) {
      if (typed.trim() === "" || date < values.firstDay || date > values.lastDay) continue;
      const value = Number(typed);
      if (Number.isFinite(value)) hours[date] = value;
    }
  }
  return {
    policyId: values.policyId,
    firstDay: values.firstDay,
    lastDay: values.lastDay,
    dayMode: values.dayMode,
    ...(values.dayMode === "partial" ? { hours } : {}),
    note: values.note.trim() || null,
  };
}

export function toRecordInput(values: RequestFormValues): RecordTimeOffInput {
  return { ...toRequestInput(values), employeeId: values.employeeId };
}
