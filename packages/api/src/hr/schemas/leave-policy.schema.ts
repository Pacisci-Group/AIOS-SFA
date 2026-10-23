import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { LeavePolicyRules, LeavePolicyStatus } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type LeavePolicyDocument = HydratedDocument<LeavePolicy>;

/**
 * A named bundle of leave and attendance rules (PAC-161) — the epic's §2
 * table, held whole in `rules`.
 *
 * ## `rules` is one Mixed sub-document, validated by the DTO
 *
 * The rules object is ~40 settings across eight sections, several of them
 * arrays of objects, and it will grow with every HR sub-story. A Mongoose
 * sub-schema per section would be a second copy of the shape that
 * `LeavePolicyRules` (shared) and the zod DTO already define, and the three
 * would drift. The DTO is the gate; what it accepts is stored as-is. Reads
 * type it as `LeavePolicyRules`.
 *
 * ## No default policy (Asad, 2026-10-22)
 *
 * There is no `isDefault`. An agency may hold zero rows — that is the agency
 * not using leave — and a policy is chosen per employee at employee
 * onboarding (PAC-162). `version` bumps on every edit so a posted record's
 * snapshot can say which rules it was judged under.
 *
 * Agency-level, string `agencyId`, no `branchId` — see `AgencyCalendar`.
 */
@Schema({ timestamps: true, collection: 'leavePolicies' })
export class LeavePolicy {
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
  status: LeavePolicyStatus;

  @Prop({ required: true, default: 1 })
  version: number;

  @Prop({ type: Object, required: true })
  rules: LeavePolicyRules;

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

export const LeavePolicySchema = SchemaFactory.createForClass(LeavePolicy);

/** The list, and the "active policy exists?" gate. */
LeavePolicySchema.index({ agencyId: 1, status: 1, name: 1 });
