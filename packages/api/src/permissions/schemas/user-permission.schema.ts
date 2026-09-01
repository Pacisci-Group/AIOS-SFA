import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserPermissionDocument = HydratedDocument<UserPermission>;

/**
 * `grant` adds a permission the user's roles do not give; `revoke` removes one
 * they do.
 */
export type PermissionEffect = 'grant' | 'revoke';

/**
 * user ↔ permission — the per-user overrides on top of role defaults.
 *
 * Stored as a diff against role defaults, not as an absolute set, so a user
 * keeps inheriting later role changes on every permission they have not
 * explicitly overridden. `UsersService.updatePermissions` computes that diff.
 *
 * The unique `(userId, permissionKey)` index makes grant-and-revoke of the same
 * permission unrepresentable, which is the invariant the old parallel
 * `permissionGrants[]` / `permissionRevokes[]` arrays could only hope for.
 */
@Schema({ timestamps: true, collection: 'userPermissions' })
export class UserPermission {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Permission', required: true })
  permissionId: Types.ObjectId;

  /** Denormalized from `Permission.key`; see `RolePermission.permissionKey`. */
  @Prop({ required: true })
  permissionKey: string;

  @Prop({ type: String, required: true, enum: ['grant', 'revoke'] })
  effect: PermissionEffect;

  /** Opts this schema into `authorshipPlugin`; see `TenantRecord`. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;
}

export const UserPermissionSchema =
  SchemaFactory.createForClass(UserPermission);
UserPermissionSchema.index({ userId: 1, permissionKey: 1 }, { unique: true });
