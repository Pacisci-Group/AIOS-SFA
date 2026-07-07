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

  /** Extra permissions granted directly by the agency owner. */
  @Prop({ type: [String], default: [] })
  permissionGrants: string[];

  /** Permissions removed from the user's effective set by the agency owner. */
  @Prop({ type: [String], default: [] })
  permissionRevokes: string[];

  @Prop({ default: false })
  isPlatformAdmin: boolean;

  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  legacySmartSuiteId?: string;

  @Prop()
  inviteToken?: string;

  @Prop()
  inviteTokenExpiresAt?: Date;

  @Prop()
  passwordResetToken?: string;

  @Prop()
  passwordResetExpiresAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ agencyId: 1, branchId: 1, createdAt: -1 });
UserSchema.index({ legacySmartSuiteId: 1 }, { unique: true, sparse: true });
