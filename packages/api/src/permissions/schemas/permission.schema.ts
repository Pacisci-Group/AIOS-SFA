import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { ModuleKey, PermissionKind } from '@sfa/shared';

export type PermissionDocument = HydratedDocument<Permission>;

/**
 * The permission vocabulary, as rows.
 *
 * Seeded from `PERMISSION_CATALOG` in `@sfa/shared` — this collection describes
 * the permission strings the constants define, it does not define them. The
 * guards still compare against string literals, so {@link key} is the contract
 * and is immutable; everything else here is presentation and grouping.
 *
 * **Global, with no `agencyId`.** A per-agency catalog would let configuration
 * delete a permission that a `@RequirePermissions` decorator still names, which
 * denies everyone with no error anywhere. Per-tenant availability is a separate
 * question, already answered by `agency.modules[key].enabled` and applied by
 * `resolvePermissionSet`'s module filter. `carriers` is seeded the same way.
 */
@Schema({ timestamps: true, collection: 'permissions' })
export class Permission {
  /**
   * The permission string, e.g. `leads:read`. Unique, and never rewritten —
   * `rolePermissions` and `userPermissions` denormalize it precisely because it
   * cannot change.
   */
  @Prop({ required: true, unique: true, trim: true })
  key: string;

  @Prop({
    type: String,
    required: true,
    enum: ['module', 'agency', 'platform'],
  })
  kind: PermissionKind;

  /** The page this gates. Null for `agency:*` / `platform:*` capabilities. */
  @Prop({ type: String, default: null })
  moduleKey: ModuleKey | null;

  /** Everything before the final colon: `leads`, `agency:users`, `platform`. */
  @Prop({ required: true })
  resource: string;

  /** The final colon segment: `read`, `write`, `permissions`, `toggle`. */
  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  label: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ required: true })
  group: string;

  @Prop({ required: true })
  sortOrder: number;

  /**
   * Whether an owner may grant or revoke this on an individual user. True only
   * for page permissions — admin capabilities come from role membership alone,
   * matching what `UsersService.updatePermissions` has always enforced.
   */
  @Prop({ default: true })
  assignableToUser: boolean;

  /**
   * Set when a key leaves the constants. **Never delete a row instead**:
   * `rolePermissions` may still point at it, and a dangling reference is worse
   * than a permission nobody can grant.
   */
  @Prop({ default: false })
  isDeprecated: boolean;
}

export const PermissionSchema = SchemaFactory.createForClass(Permission);
PermissionSchema.index({ kind: 1, sortOrder: 1 });
