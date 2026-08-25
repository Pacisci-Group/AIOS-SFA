import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ type: Types.ObjectId, ref: 'Agency', index: true })
  agencyId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch', index: true })
  branchId?: Types.ObjectId;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'AgencyRole' }], default: [] })
  roleIds: Types.ObjectId[];

  /** Page permissions added on top of role defaults by the agency owner. */
  @Prop({ type: [String], default: [] })
  permissionGrants: string[];

  /** Page permissions removed from role defaults by the agency owner. */
  @Prop({ type: [String], default: [] })
  permissionRevokes: string[];

  @Prop({ default: false })
  isPlatformAdmin: boolean;

  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  /**
   * ⚠ `isActive: false` alone does **not** mean "pending invite".
   *
   * It meant exactly that until removal landed, and a good deal of code was
   * written against that assumption. It now covers two different states, told
   * apart by {@link deactivatedAt}:
   *
   * | State       | `isActive` | `deactivatedAt` | `inviteToken` |
   * |-------------|------------|-----------------|---------------|
   * | Active      | `true`     | null            | —             |
   * | Invited     | `false`    | **null**        | set           |
   * | Deactivated | `false`    | **set**         | cleared       |
   *
   * Anything asking "is this a pending invite?" must check **both** fields —
   * see `UsersService.findPendingInvite`, which is the one place that decides
   * it for the whole invite flow. Checking only `isActive` there would let an
   * owner "resend" an invite to somebody they had just removed, mailing them a
   * working account-activation link.
   */
  @Prop({ default: true })
  isActive: boolean;

  /** When the user was removed from the agency. Null for active and invited. */
  @Prop({ type: Date, default: null })
  deactivatedAt: Date | null;

  /** Who removed them. Null when never deactivated. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deactivatedByUserId: Types.ObjectId | null;

  @Prop()
  legacySmartSuiteId?: string;

  @Prop()
  inviteToken?: string;

  @Prop()
  inviteTokenExpiresAt?: Date;

  /**
   * When the invite email was last dispatched. Backs the per-user resend
   * cooldown (PAC-58) — the global throttler is per-IP, which would not stop one
   * owner mailbombing one invitee from a single session.
   */
  @Prop()
  inviteLastSentAt?: Date;

  @Prop()
  passwordResetToken?: string;

  @Prop()
  passwordResetExpiresAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ agencyId: 1, branchId: 1, createdAt: -1 });
UserSchema.index({ legacySmartSuiteId: 1 }, { unique: true, sparse: true });
