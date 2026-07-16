import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import {
  ALL_MODULE_KEYS,
  DEFAULT_ROLE_TEMPLATES,
  normalizeLegacyPermission,
  pageLevelToPermissions,
  permissionsToPageLevel,
} from '@sfa/shared';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import { AgencyRole, AgencyRoleDocument } from '../roles/schemas/agency-role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

/**
 * One-off migration to the simplified per-page permission model.
 *
 *  1. Roles: normalize legacy fine-grained permission strings
 *     (`{m}:access`, `{m}:view:*`, `{m}:manage`, `{m}:contact`, `{m}:resolve`)
 *     into `{m}:read` / `{m}:write`.
 *  2. Users: convert legacy per-user snapshots (`hasCustomPermissions` +
 *     `permissions[]`) into `permissionGrants` / `permissionRevokes` computed
 *     as diffs against the user's role defaults, then drop the legacy fields.
 *
 * Idempotent: re-running on already-migrated data is a no-op.
 */
async function migrate() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const roleModel = app.get<Model<AgencyRoleDocument>>(
    getModelToken(AgencyRole.name),
  );
  const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
  const agencyModel = app.get<Model<AgencyDocument>>(getModelToken(Agency.name));
  const permissionsService = app.get(PermissionsService);

  // Admin (`agency:` / `platform:`) permissions each system template should
  // carry, keyed by slug. Used to backfill new admin permissions (e.g.
  // `agency:roles:write`) onto pre-existing roles without touching page perms.
  const templateAdminPermsBySlug = new Map<string, string[]>(
    DEFAULT_ROLE_TEMPLATES.map((template) => [
      template.slug,
      template.permissions.filter(
        (permission) =>
          permission.startsWith('agency:') ||
          permission.startsWith('platform:'),
      ),
    ]),
  );

  // --- 1. Normalize role permissions -------------------------------------
  const roles = await roleModel.find().exec();
  let rolesUpdated = 0;
  for (const role of roles) {
    const templateAdminPerms = templateAdminPermsBySlug.get(role.slug) ?? [];
    const normalized = [
      ...new Set([
        ...role.permissions.flatMap((p) => normalizeLegacyPermission(p)),
        ...templateAdminPerms,
      ]),
    ];
    const current = new Set(role.permissions);
    const changed =
      normalized.length !== role.permissions.length ||
      normalized.some((p) => !current.has(p));
    if (changed) {
      role.permissions = normalized;
      await role.save();
      rolesUpdated += 1;
    }
  }
  console.log(`Normalized permissions on ${rolesUpdated} role(s).`);

  // --- 2. Convert per-user snapshots to grants/revokes -------------------
  const enabledCache = new Map<string, Set<string>>();
  const enabledFor = async (agencyId: string): Promise<Set<string>> => {
    if (enabledCache.has(agencyId)) {
      return enabledCache.get(agencyId)!;
    }
    const agency = await agencyModel.findById(agencyId).lean();
    const enabled = new Set(
      agency
        ? Object.entries(agency.modules ?? {})
            .filter(([, entry]) => entry.enabled)
            .map(([key]) => key)
        : [],
    );
    enabledCache.set(agencyId, enabled);
    return enabled;
  };

  // Read raw docs so we can see legacy fields no longer on the schema.
  const rawUsers = await userModel.collection
    .find({ hasCustomPermissions: true })
    .toArray();

  let usersUpdated = 0;
  for (const raw of rawUsers) {
    const user = await userModel.findById(raw._id);
    if (!user || !user.agencyId) {
      continue;
    }

    const snapshot = new Set(
      ((raw.permissions as string[]) ?? []).flatMap((p) =>
        normalizeLegacyPermission(p),
      ),
    );
    const roleDefaults = new Set(
      await permissionsService.resolveRoleDefaults(user),
    );
    const enabled = await enabledFor(user.agencyId.toString());

    const grants = new Set<string>();
    const revokes = new Set<string>();

    for (const moduleKey of ALL_MODULE_KEYS) {
      if (!enabled.has(moduleKey)) {
        continue;
      }
      const roleLevel = permissionsToPageLevel(roleDefaults, moduleKey);
      const desiredLevel = permissionsToPageLevel(snapshot, moduleKey);
      if (roleLevel === desiredLevel) {
        continue;
      }
      const rolePerms = new Set(pageLevelToPermissions(moduleKey, roleLevel));
      const desiredPerms = new Set(
        pageLevelToPermissions(moduleKey, desiredLevel),
      );
      for (const permission of desiredPerms) {
        if (!rolePerms.has(permission)) grants.add(permission);
      }
      for (const permission of rolePerms) {
        if (!desiredPerms.has(permission)) revokes.add(permission);
      }
    }

    await userModel.collection.updateOne(
      { _id: raw._id },
      {
        $set: {
          permissionGrants: [...grants],
          permissionRevokes: [...revokes],
        },
        $unset: { hasCustomPermissions: '', permissions: '' },
      },
    );
    usersUpdated += 1;
  }
  console.log(`Migrated ${usersUpdated} user snapshot(s) to grants/revokes.`);

  // Drop legacy fields from any remaining users that still carry them.
  const cleanup = await userModel.collection.updateMany(
    {
      $or: [
        { hasCustomPermissions: { $exists: true } },
        { permissions: { $exists: true } },
      ],
    },
    { $unset: { hasCustomPermissions: '', permissions: '' } },
  );
  console.log(`Cleaned legacy fields on ${cleanup.modifiedCount} user(s).`);

  console.log('\nPermission migration complete.');
  await app.close();
}

migrate().catch((error) => {
  console.error('Permission migration failed:', error);
  process.exit(1);
});
