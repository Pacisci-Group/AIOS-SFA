import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';

const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:mm on a 24-hour clock.');

const shift = z
  .object({ start: clock, end: clock })
  .refine((day) => day.end > day.start, {
    message: 'The end must be after the start.',
    path: ['end'],
  });

/**
 * A `WorkSchedule`: weekday (`"0"`–`"6"`, Sunday first) → a shift, or `null`
 * for a day off. Shared by the template editor and the per-employee
 * override (PAC-162). Shape only here; the cross-field checks that need the
 * agency (nothing yet) stay in `validateSchedule`.
 */
export const workScheduleSchema = z
  .record(z.string().regex(/^[0-6]$/, 'A weekday is 0–6.'), shift.nullable())
  .transform((schedule) =>
    Object.fromEntries(
      Object.entries(schedule).map(([key, day]) => [Number(key), day]),
    ),
  );
export type WorkScheduleDto = z.infer<typeof workScheduleSchema>;

const templateName = z
  .string()
  .trim()
  .min(1, 'Give the schedule a name.')
  .max(80, 'Keep the name under 80 characters.');

/** `POST /hr/schedule-templates` — a name; the schedule defaults to the workweek. */
export const createScheduleTemplateSchema = z.object({
  name: templateName,
  schedule: workScheduleSchema.optional(),
});
export type CreateScheduleTemplateDto = z.infer<
  typeof createScheduleTemplateSchema
>;

/** `PATCH /hr/schedule-templates/:id` — a name, a schedule, or both. */
export const updateScheduleTemplateSchema = z
  .object({
    name: templateName.optional(),
    schedule: workScheduleSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.schedule !== undefined, {
    message: 'Send a name, a schedule, or both.',
  });
export type UpdateScheduleTemplateDto = z.infer<
  typeof updateScheduleTemplateSchema
>;

export const scheduleTemplateIdSchema = objectId;
