import { HR_CALENDAR_MAX_RANGE_DAYS, parseIsoDay } from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';
import { multiValue } from '../../leads/dto/multi-value';

/** `YYYY-MM-DD` naming a real day. */
const isoDay = z
  .string()
  .trim()
  .refine(
    (value) => parseIsoDay(value) !== null,
    'must be a date (YYYY-MM-DD)',
  );

/** Bounded so a hand-built URL cannot hand Mongo an `$in` of arbitrary size. */
const FILTER_MAX = 100;

const idList = z.preprocess(
  multiValue,
  z.array(objectId).max(FILTER_MAX).optional(),
);

/**
 * `GET /hr/calendar`. `from` and `to` are inclusive days on the agency's
 * calendar — what the page's grid shows, at most
 * `HR_CALENDAR_MAX_RANGE_DAYS` apart: every layer but the events is computed
 * per day or per person, so an unbounded range is an unbounded read.
 *
 * `branchId` / `employeeId` (repeatable, or comma-separated) narrow the
 * people-shaped layers. They never widen what the caller may see: an id
 * outside their scope simply matches nothing.
 */
export const hrCalendarQuerySchema = z
  .object({
    from: isoDay,
    to: isoDay,
    branchId: idList,
    employeeId: idList,
  })
  .superRefine((query, ctx) => {
    const from = parseIsoDay(query.from);
    const to = parseIsoDay(query.to);
    if (!from || !to) return;
    if (to < from) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'must not be before from',
      });
      return;
    }
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > HR_CALENDAR_MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `the range can cover at most ${HR_CALENDAR_MAX_RANGE_DAYS} days`,
      });
    }
  })
  .transform((query) => ({
    from: query.from,
    to: query.to,
    branchIds: [...new Set(query.branchId ?? [])],
    employeeIds: [...new Set(query.employeeId ?? [])],
  }));
export type HrCalendarQueryDto = z.infer<typeof hrCalendarQuerySchema>;
