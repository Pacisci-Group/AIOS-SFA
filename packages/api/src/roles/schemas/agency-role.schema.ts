import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { DataScope } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';

export type AgencyRoleDocument = HydratedDocument<AgencyRole>;

@Schema({ timestamps: true, collection: 'roles' })
export class AgencyRole {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ trim: true })
  description?: string;

  /*
   * The permissions this role grants live in `rolePermissions`, not here.
   *
   * Written only by `RoleAssignmentsService.setRolePermissions`; read through
   * `.rolePermissionKeys`, or resolved for a user by `PermissionsService`.
   */

  @Prop({ type: String, enum: DataScope, default: DataScope.Branch })
  dataScope: DataScope;

  @Prop({ default: true })
  isSystemTemplate: boolean;

  @Prop({ default: false })
  grantsAllEnabledModules: boolean;
}

export const AgencyRoleSchema = SchemaFactory.createForClass(AgencyRole);
AgencyRoleSchema.index({ agencyId: 1, slug: 1 }, { unique: true });
