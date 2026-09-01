import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RolePermissionDocument = HydratedDocument<RolePermission>;

/** Where the row came from, for support questions about a surprising grant. */
export type RolePermissionSource = 'template' | 'custom';

/**
 * role ↔ permission.
 *
 * Written only by `RoleAssignmentsService.setRolePermissions`. Nothing else may
 * touch this collection: the single-writer rule is what keeps the cache
 * invalidation and the owner-protection checks from being bypassed.
 */
@Schema({ timestamps: true, collection: 'rolePermissions' })
export class RolePermission {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'AgencyRole', required: true })
  roleId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Permission', required: true })
  permissionId: Types.ObjectId;

  /**
   * Denormalized from `Permission.key`.
   *
   * The key is immutable by contract — changing one would mean rewriting 91
   * guard decorators — so there is no update anomaly to guard against, and
   * carrying it here removes a whole `$lookup` level from the request-time
   * aggregation. The catalog stays a write-time and UI concern.
   */
  @Prop({ required: true })
  permissionKey: string;

  @Prop({ type: String, enum: ['template', 'custom'], default: 'custom' })
  source: RolePermissionSource;

  /** Opts this schema into `authorshipPlugin`; see `TenantRecord`. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy: Types.ObjectId | null;
}

export const RolePermissionSchema =
  SchemaFactory.createForClass(RolePermission);
RolePermissionSchema.index({ roleId: 1, permissionKey: 1 }, { unique: true });
RolePermissionSchema.index({ permissionId: 1 });
