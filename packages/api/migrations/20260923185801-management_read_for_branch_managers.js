/**
 * PAC-139 §7 — every Branch Manager role gains `management:read`.
 *
 * ## Why a migration and not just the template
 *
 * `DEFAULT_ROLE_TEMPLATES` is only consulted when an agency is *created*
 * (provisioning, the SmartSuite migration, the demo seed). An agency that
 * already exists keeps the `rolePermissions` rows it was seeded with, so the
 * Manager view — the page built for this persona — would 403 for every branch
 * manager in production until somebody remembered `npm run api:sync:roles`.
 * The API applies pending migrations at boot, so this one ships with the page.
 *
 * ## Idempotent
 *
 * One upsert per Branch Manager role on the unique `{ roleId, permissionKey }`
 * index: a re-run matches the row it wrote and changes nothing, and a role an
 * owner has already granted by hand is left exactly as it is (`$setOnInsert`
 * carries the audit fields; `$set` only re-asserts the catalog link).
 *
 * ## Cache
 *
 * A running API may hold the old permission set in its Redis cache for up to
 * `PERMISSION_CACHE_TTL_SECONDS`; a migration has no handle on that cache. The
 * TTL — or the branch manager's next login — is the cutover, the same caveat
 * `sync-role-templates.ts` states.
 *
 * ⚠ The role slug and permission key are **copied in, not imported** from
 * `@sfa/shared`: no TypeScript build is in this path, and an applied migration
 * must keep doing in a year what it did today.
 */

/** Copied from `DEFAULT_ROLE_TEMPLATES[].slug` (`@sfa/shared`). */
const BRANCH_MANAGER_SLUG = 'branch_manager';
/** Copied from `modulePermission(ModuleKey.Management, 'read')`. */
const PERMISSION_KEY = 'management:read';

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const permission = await db
      .collection('permissions')
      .findOne({ key: PERMISSION_KEY }, { projection: { _id: 1 } });
    if (!permission) {
      // No catalog row means no agency has been seeded on this database yet;
      // the core seed will write both the catalog and the roles from the
      // template, which already carries the key.
      console.log(
        `[management-read] no '${PERMISSION_KEY}' catalog row — nothing to grant`,
      );
      return;
    }

    const roles = await db
      .collection('roles')
      .find({ slug: BRANCH_MANAGER_SLUG }, { projection: { _id: 1, agencyId: 1 } })
      .toArray();

    const now = new Date();
    let granted = 0;
    for (const role of roles) {
      const result = await db.collection('rolePermissions').updateOne(
        { roleId: role._id, permissionKey: PERMISSION_KEY },
        {
          $set: {
            agencyId: role.agencyId,
            permissionId: permission._id,
            source: 'template',
            updatedAt: now,
          },
          $setOnInsert: {
            roleId: role._id,
            permissionKey: PERMISSION_KEY,
            createdBy: null,
            updatedBy: null,
            createdAt: now,
          },
        },
        { upsert: true },
      );
      if (result.upsertedCount > 0) granted += 1;
    }

    console.log(
      `[management-read] ${roles.length} Branch Manager role(s), granted '${PERMISSION_KEY}' to ${granted} that lacked it`,
    );
  },

  /**
   * Removes the grant from **every** Branch Manager role — including one an
   * owner had added by hand before this migration ran, which the row's
   * `source` cannot tell apart from ours. Lossy in that one case; the next
   * `up` restores it.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const roleIds = await db
      .collection('roles')
      .find({ slug: BRANCH_MANAGER_SLUG }, { projection: { _id: 1 } })
      .map((role) => role._id)
      .toArray();

    const result = await db
      .collection('rolePermissions')
      .deleteMany({ roleId: { $in: roleIds }, permissionKey: PERMISSION_KEY });

    console.log(
      `[management-read] removed '${PERMISSION_KEY}' from ${result.deletedCount} Branch Manager role(s)`,
    );
  },
};
