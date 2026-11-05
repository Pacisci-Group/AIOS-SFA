import {
  MY_TIME_OFF_REQUEST_GROUPS,
  roundHours,
  TEAM_TIME_OFF_REQUEST_GROUPS,
  TIME_OFF_DAY_MODES,
  TIME_OFF_HOURS_STEP,
  TIME_OFF_NOTE_MAX_LENGTH,
} from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';
import { clearable, trimmedText } from '../../common/dto/clearable';
import { isIsoDay } from '../../common/hr/employee-profile.rules';
import { multiValue } from '../../leads/dto/multi-value';

/**
 * Bodies and queries of `/time-off` (PAC-165).
 *
 * The schemas check **shape** only: a real date, hours in quarter hours, a
 * note that fits. Every rule that needs the database or today's date — the
 * person is enrolled, the dates do not clash, the balance covers it — is the
 * service's, because the same rules also answer the preview, where a broken
 * rule is information for the form rather than a 400.
 */

/** `YYYY-MM-DD` naming a real day. */
const isoDay = z.string().trim().refine(isIsoDay, 'Use a date, YYYY-MM-DD.');

/** Hours typed for one date on Partial days: 0–24, in quarter hours. */
const dayHours = z
  .number()
  .min(0)
  .max(24)
  .refine(
    (value) => Number.isInteger(roundHours(value / TIME_OFF_HOURS_STEP)),
    'Use quarter hours.',
  )
  .transform((value) => roundHours(value));

/** Typed hours by date. The service ignores a date outside the range. */
const hoursByDate = z
  .record(z.string(), dayHours)
  .refine(
    (map) => Object.keys(map).every(isIsoDay),
    'Each key must be a date, YYYY-MM-DD.',
  )
  .refine((map) => Object.keys(map).length <= 366, 'Too many dates.');

const requestFields = {
  policyId: objectId,
  firstDay: isoDay,
  lastDay: isoDay,
  dayMode: z.enum(TIME_OFF_DAY_MODES),
  hours: hoursByDate.optional(),
  note: clearable(trimmedText(TIME_OFF_NOTE_MAX_LENGTH)),
};

const inOrder = (body: { firstDay: string; lastDay: string }) =>
  body.firstDay <= body.lastDay;
const IN_ORDER = {
  message: 'The last day cannot be before the first day.',
  path: ['lastDay'],
};

/** The four inputs of a request: policy, dates, full or partial days, note. */
export const timeOffRequestSchema = z
  .object(requestFields)
  .refine(inOrder, IN_ORDER);
export type TimeOffRequestDto = z.infer<typeof timeOffRequestSchema>;

/** `POST /time-off/requests` — `send: false` saves a Draft. */
export const createTimeOffRequestSchema = z
  .object({ ...requestFields, send: z.boolean() })
  .refine(inOrder, IN_ORDER);
export type CreateTimeOffRequestDto = z.infer<
  typeof createTimeOffRequestSchema
>;

/** `POST /time-off/requests/preview` — `requestId` names the request being edited. */
export const previewTimeOffRequestSchema = z
  .object({ ...requestFields, requestId: objectId.optional() })
  .refine(inOrder, IN_ORDER);
export type PreviewTimeOffRequestDto = z.infer<
  typeof previewTimeOffRequestSchema
>;

/**
 * `POST /time-off/requests/:id/submit` — the edited form, or an empty body
 * to send the request as it is saved.
 */
export const submitTimeOffRequestSchema = z.union([
  timeOffRequestSchema,
  z.object({}).strict(),
]);
export type SubmitTimeOffRequestDto = z.infer<
  typeof submitTimeOffRequestSchema
>;

/** `POST /time-off/records` — time off recorded for somebody else. */
export const recordTimeOffSchema = z
  .object({ ...requestFields, employeeId: objectId })
  .refine(inOrder, IN_ORDER);
export type RecordTimeOffDto = z.infer<typeof recordTimeOffSchema>;

/**
 * The note that travels with an action. Optional on approve and on an
 * employee's own cancellation; the service requires it where the lifecycle
 * does (request changes, decline, a reviewer cancelling approved leave) —
 * who is asking decides, so it cannot be a schema rule on `cancel`.
 */
export const timeOffDecisionSchema = z.object({
  note: clearable(trimmedText(TIME_OFF_NOTE_MAX_LENGTH)),
});
export type TimeOffDecisionDto = z.infer<typeof timeOffDecisionSchema>;

/** Request changes and decline: the note is the point. */
export const timeOffNoteRequiredSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, 'Write a note for the employee.')
    .max(TIME_OFF_NOTE_MAX_LENGTH),
});
export type TimeOffNoteRequiredDto = z.infer<typeof timeOffNoteRequiredSchema>;

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
};

/** `GET /time-off/requests/mine` — the caller's own requests, every group by default. */
export const listMyTimeOffRequestsSchema = z.object({
  ...paging,
  group: z.preprocess(
    multiValue,
    z
      .array(z.enum(MY_TIME_OFF_REQUEST_GROUPS))
      .max(MY_TIME_OFF_REQUEST_GROUPS.length)
      .optional(),
  ),
});
export type ListMyTimeOffRequestsDto = z.infer<
  typeof listMyTimeOffRequestsSchema
>;

/**
 * `GET /time-off/requests` — the team list. No group means **To review**:
 * the list a reviewer opens is the work waiting for them. Drafts are not a
 * group here; nobody sees another person's draft.
 */
export const listTeamTimeOffRequestsSchema = z.object({
  ...paging,
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  group: z.preprocess(
    multiValue,
    z
      .array(z.enum(TEAM_TIME_OFF_REQUEST_GROUPS))
      .max(TEAM_TIME_OFF_REQUEST_GROUPS.length)
      .optional(),
  ),
  /** The employee's name. */
  q: z.string().trim().max(120).optional(),
  policyId: objectId.optional(),
  employeeId: objectId.optional(),
});
export type ListTeamTimeOffRequestsDto = z.infer<
  typeof listTeamTimeOffRequestsSchema
>;

/** `GET /time-off/recordable-people`. */
export const listRecordablePeopleSchema = z.object({
  q: z.string().trim().max(120).optional(),
});
export type ListRecordablePeopleDto = z.infer<
  typeof listRecordablePeopleSchema
>;

export const timeOffRequestIdParamSchema = objectId;
