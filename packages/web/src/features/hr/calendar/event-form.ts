import {
  AGENCY_EVENT_AUDIENCE_KINDS,
  AGENCY_EVENT_EFFECTS,
  agencyEventError,
  type AgencyEventInput,
  type AgencyEventView,
} from "@sfa/shared";
import { z } from "zod";

/**
 * The agency event form (PAC-169): name, days, an optional time, what the
 * event does to time off, and who it is for.
 *
 * The rules are `agencyEventError` in `@sfa/shared` — the function the API
 * validates with — so the form cannot accept what saving refuses. The schema
 * here only decides **which field** a broken rule is shown under.
 *
 * Dates and times are the strings their inputs hold (`YYYY-MM-DD`, `HH:mm`);
 * an empty string is "not set". `branchIds` / `userIds` are array fields:
 * they are seeded through `defaultValues` and never reset (see
 * `docs/tanstack-form-spike-findings.md`).
 */
export const eventFormSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    firstDay: z.string(),
    lastDay: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    effect: z.enum(AGENCY_EVENT_EFFECTS),
    audienceKind: z.enum(AGENCY_EVENT_AUDIENCE_KINDS),
    branchIds: z.array(z.string()),
    userIds: z.array(z.string()),
  })
  .superRefine((values, ctx) => {
    const error = agencyEventError(toEventInput(values));
    if (error) ctx.addIssue({ code: "custom", path: [fieldOf(error)], message: error });
  });

export type EventFormValues = z.infer<typeof eventFormSchema>;

/** Which input a rule's message belongs under. */
function fieldOf(message: string): keyof EventFormValues {
  if (/name/i.test(message)) return "name";
  if (/description/i.test(message)) return "description";
  if (/start date/i.test(message)) return "firstDay";
  if (/end date|days/i.test(message)) return "lastDay";
  if (/start time/i.test(message)) return "startTime";
  if (/end time/i.test(message)) return "endTime";
  if (/branch/i.test(message)) return "branchIds";
  return "userIds";
}

export function eventFormDefaults(
  event: AgencyEventView | null,
  range?: { from: string; to: string },
): EventFormValues {
  return {
    name: event?.name ?? "",
    description: event?.description ?? "",
    firstDay: event?.firstDay ?? range?.from ?? "",
    lastDay: event?.lastDay ?? range?.to ?? range?.from ?? "",
    startTime: event?.startTime ?? "",
    endTime: event?.endTime ?? "",
    effect: event?.effect ?? "none",
    audienceKind: event?.audience.kind ?? "agency",
    branchIds: event?.audience.branchIds ?? [],
    userIds: event?.audience.userIds ?? [],
  };
}

/** The form's values as the API takes an event. */
export function toEventInput(values: EventFormValues): AgencyEventInput {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    firstDay: values.firstDay,
    lastDay: values.lastDay || values.firstDay,
    startTime: values.startTime || null,
    endTime: values.endTime || null,
    effect: values.effect,
    audience: {
      kind: values.audienceKind,
      branchIds: values.audienceKind === "branches" ? values.branchIds : [],
      userIds: values.audienceKind === "people" ? values.userIds : [],
    },
  };
}
