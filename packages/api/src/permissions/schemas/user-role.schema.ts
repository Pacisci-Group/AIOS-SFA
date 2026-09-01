import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserRoleDocument = HydratedDocument<UserRole>;

/**
 * user ↔ role. A user may hold several; their permissions union and their
 * `dataScope` collapses to the widest.
 *
 * Written only by `RoleAssignmentsService.setUserRoles`, which is also where
 * owner protection is enforced — so a second writer would be a way to strip an
 * owner's role without passing the check.
 *
 * ⚠ `AccessResolverService.invalidateRole` reads this collection to find whose
 * cached permissions to drop. A role assignment recorded anywhere else is a
 * user whose permissions go stale for the full cache TTL, silently.
 */
@Schema({ timestamps: true, collection: 'userRoles' })
export class UserRole {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'AgencyRole', required: true })
  roleId: Types.ObjectId;

  /** Opts this schema into `authorshipPlugin`; see `TenantRecord`. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;
}

export const UserRoleSchema = SchemaFactory.createForClass(UserRole);
UserRoleSchema.index({ userId: 1, roleId: 1 }, { unique: true });
// Serves invalidateRole, the owner count, and the CRM assignee picker.
UserRoleSchema.index({ agencyId: 1, roleId: 1 });
