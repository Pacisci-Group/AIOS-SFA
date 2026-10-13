import type { PipelineStage } from 'mongoose';
import { leadCreatedYmdExpr } from '../../sales-metrics/sales-pipelines';
import {
  addDays,
  parseIsoDate,
  toYmd,
  zonedDayStart,
} from '../../../performance/performance.range';
import type { DateFieldDef } from './dataset.types';

/** Field the `leadCreated` window is cut on, added by its own `$addFields`. */
export const LEAD_CREATED_YMD_FIELD = '_createdYmd';

/**
 * The stages that keep rows whose `field` falls on `from`…`to` — both
 * inclusive calendar dates, either omitted for an open end, both omitted for
 * no window at all.
 *
 * Every window is half-open underneath (`$gte` start, `$lt` the day after
 * `to`), the convention every dashboard range in this API uses.
 */
export function dateWindowStages(
  field: DateFieldDef,
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): PipelineStage[] {
  if (!from && !to) return [];

  const start = from ? parseIsoDate(from) : null;
  const end = to ? addDays(parseIsoDate(to), 1) : null;

  const bounds = (
    toValue: (date: ReturnType<typeof parseIsoDate>) => unknown,
  ): Record<string, unknown> => ({
    ...(start ? { $gte: toValue(start) } : {}),
    ...(end ? { $lt: toValue(end) } : {}),
  });

  switch (field.kind) {
    case 'ymd':
      return [{ $match: { [field.path]: bounds(toYmd) } }];
    case 'instant':
      return [
        {
          $match: {
            [field.path]: bounds((date) => zonedDayStart(date, timeZone)),
          },
        },
      ];
    case 'utcDate':
      return [
        {
          $match: {
            [field.path]: bounds(
              (date) => new Date(Date.UTC(date.year, date.month - 1, date.day)),
            ),
          },
        },
      ];
    case 'leadCreated':
      return [
        {
          $addFields: {
            [LEAD_CREATED_YMD_FIELD]: leadCreatedYmdExpr(timeZone),
          },
        },
        { $match: { [LEAD_CREATED_YMD_FIELD]: bounds(toYmd) } },
      ];
  }
}
