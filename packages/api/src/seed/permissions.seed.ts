import { PERMISSION_CATALOG } from '@sfa/shared';
import { Model } from 'mongoose';
import { Permission } from '../permissions/schemas/permission.schema';

export interface PermissionSeedResult {
  created: number;
  updated: number;
  deprecated: number;
}

/**
 * Seed the permission catalog from the shared constants.
 *
 * Platform-required global data, like `carriers` — the rows carry no
 * `agencyId`, so one pass serves every tenant. It must run before any role is
 * seeded: `RoleAssignmentsService.setRolePermissions` resolves each key to a
 * catalog `_id` and refuses a key with no row, so a missing catalog turns role
 * seeding into a hard failure rather than a silent one.
 *
 * **Keys are never deleted.** A key that has left the constants is marked
 * `isDeprecated` instead, because `rolePermissions` rows may still point at it
 * and a dangling reference is worse than a permission nobody can grant. Clean
 * those up deliberately, with a script that also rewrites the referencing rows.
 */
export async function seedPermissions(
  permissionModel: Model<Permission>,
): Promise<PermissionSeedResult> {
  const result: PermissionSeedResult = {
    created: 0,
    updated: 0,
    deprecated: 0,
  };

  for (const definition of PERMISSION_CATALOG) {
    const outcome = await permissionModel.updateOne(
      { key: definition.key },
      {
        $set: {
          kind: definition.kind,
          moduleKey: definition.moduleKey,
          resource: definition.resource,
          action: definition.action,
          label: definition.label,
          description: definition.description,
          group: definition.group,
          sortOrder: definition.sortOrder,
          assignableToUser: definition.assignableToUser,
          // A key that comes back into the constants is un-deprecated.
          isDeprecated: false,
        },
        $setOnInsert: { key: definition.key },
      },
      { upsert: true },
    );
    if (outcome.upsertedCount) {
      result.created += 1;
    } else if (outcome.modifiedCount) {
      result.updated += 1;
    }
  }

  const known = PERMISSION_CATALOG.map((definition) => definition.key);
  const retired = await permissionModel.updateMany(
    { key: { $nin: known }, isDeprecated: { $ne: true } },
    { $set: { isDeprecated: true } },
  );
  result.deprecated = retired.modifiedCount;

  return result;
}
