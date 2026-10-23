import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { WorkSchedule, WorkScheduleTemplateStatus } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type WorkScheduleTemplateDocument = HydratedDocument<WorkScheduleTemplate>;

/**
 * A named weekly schedule an employee can be put on (PAC-162) — "Mon–Fri
 * 9–5", "Four tens". The profile references one by id and may override it
 * day by day; with neither, the agency workweek at 09:00–17:00 applies, so
 * an agency that never creates a template still gets correct hours.
 *
 * Nothing is seeded, like leave policies: a template is the agency's own.
 * Archiving one 409s while a non-terminated profile references it.
 *
 * Agency-level, string `agencyId`, no `branchId` — see `AgencyCalendar`.
 */
@Schema({ timestamps: true, collection: 'workScheduleTemplates' })
export class WorkScheduleTemplate {
  @Prop({ required: true, index: true })
  agencyId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    type: String,
    required: true,
    enum: ['active', 'archived'],
    default: 'active',
  })
  status: WorkScheduleTemplateStatus;

  @Prop({ required: true, default: 1 })
  version: number;

  /** `WorkSchedule` — weekday → `{ start, end }` on the agency's clock. */
  @Prop({ type: Object, required: true })
  schedule: WorkSchedule;

  @Prop({ type: Date, default: null })
  archivedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  archivedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const WorkScheduleTemplateSchema = SchemaFactory.createForClass(
  WorkScheduleTemplate,
);

WorkScheduleTemplateSchema.index({ agencyId: 1, status: 1, name: 1 });
