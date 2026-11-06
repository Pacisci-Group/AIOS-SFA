import {
  AGENCY_EVENT_AUDIENCE_KINDS,
  AGENCY_EVENT_AUDIENCE_MAX,
  AGENCY_EVENT_EFFECTS,
  agencyEventError,
  type AgencyEventInput,
} from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';

const ids = z
  .array(objectId)
  .max(
    AGENCY_EVENT_AUDIENCE_MAX,
    `At most ${AGENCY_EVENT_AUDIENCE_MAX} branches or people.`,
  )
  .default([]);

/**
 * The list a kind does not use is dropped here, so what is stored — and what
 * the audience check reads — never carries a leftover from a form that
 * switched kinds.
 */
const audience = z
  .object({
    kind: z.enum(AGENCY_EVENT_AUDIENCE_KINDS),
    branchIds: ids,
    userIds: ids,
  })
  .transform((row) => ({
    kind: row.kind,
    branchIds: row.kind === 'branches' ? [...new Set(row.branchIds)] : [],
    userIds: row.kind === 'people' ? [...new Set(row.userIds)] : [],
  }));

const fields = {
  name: z.string(),
  description: z.string().nullish(),
  firstDay: z.string().trim(),
  // Blank or missing → a single day.
  lastDay: z.string().trim().nullish(),
  startTime: z.string().trim().nullish(),
  endTime: z.string().trim().nullish(),
  effect: z.enum(AGENCY_EVENT_EFFECTS).default('none'),
  audience: audience.default({ kind: 'agency', branchIds: [], userIds: [] }),
};

type Raw = z.output<z.ZodObject<typeof fields>>;

/** Trimmed, blanks to `null`, a missing last day to the first. */
function normalise(row: Raw): AgencyEventInput {
  return {
    name: row.name.trim(),
    description: row.description?.trim() || null,
    firstDay: row.firstDay,
    lastDay: row.lastDay || row.firstDay,
    startTime: row.startTime || null,
    endTime: row.endTime || null,
    effect: row.effect,
    audience: row.audience,
  };
}

function check(row: AgencyEventInput, ctx: z.RefinementCtx): void {
  const error = agencyEventError(row);
  if (error) ctx.addIssue({ code: 'custom', message: error });
}

/**
 * `POST /hr/events`, `PATCH /hr/events/:eventId` and `POST /hr/events/impact`
 * (which writes nothing). An edit sends the whole
 * event, like the form holds it — there is no field an event has that the
 * sheet does not show. The rules are `agencyEventError` (shared), so the
 * form and the API cannot disagree.
 */
export const agencyEventSchema = z
  .object(fields)
  .transform(normalise)
  .superRefine(check);
export type AgencyEventDto = z.infer<typeof agencyEventSchema>;

export const eventIdParamSchema = z.object({ eventId: objectId });
