/**
 * PAC-136 — every Agency Owner role gains `agency:work_transfer:write`.
 *
 * ## Why a migration and not just the template
 *
 * The Owner template grants every `AgencyPermission`, but `DEFAULT_ROLE_TEMPLATES`
 * is only consulted when an agency is *created*. An existing agency keeps the
 * `rolePermissions` rows it was seeded with, so "Transfer work" would be
 * invisible to every owner in production until somebody remembered
 * `npm run api:sync:roles` — exactly how PAC-133 locked owners out of the
 * white-label settings. The API applies pending migrations at boot, so this
 * ships with the feature.
 *
 * ## The catalog row comes first
 *
 * `rolePermissions` rows point at a `permissions` catalog row, and a brand-new
 * key has none on an existing database. It is upserted here with the values
 * `PERMISSION_CATALOG` derives for it (`adminDefinitions()` in
 * `@sfa/shared`); the next `seedPermissions` run re-asserts the same values, so
 * the two cannot drift. Skipped entirely on a database with no catalog at all —
 * the core seed writes catalog and roles from the template there.
 *
 * ## Idempotent
 *
 * Both writes are upserts on unique keys (`key`; `{ roleId, permissionKey }`).
 * A re-run matches the rows it wrote and changes nothing.
 *
 * ## Cache
 *
 * A running API may hold the old permission set in Redis for up to
 * `PERMISSION_CACHE_TTL_SECONDS`; the TTL or the owner's next login is the
 * cutover, as `sync-role-templates.ts` states.
 *
 * ⚠ The slug, key and catalog values are **copied in, not imported** from
 * `@sfa/shared`: no TypeScript build is in this path, and an applied migration
 * must keep doing in a year what it did today.
 */

/** Copied from `DEFAULT_ROLE_TEMPLATES[].slug` (`@sfa/shared`). */
const AGENCY_OWNER_SLUG = 'agency_owner';
/** Copied from `AgencyPermission.WorkTransfer`. */
const PERMISSION_KEY = 'agency:work_transfer:write';
const LOG = '[work-transfer-permission]';

/** What `adminDefinitions()` produces for the key (index 16 → sortOrder 1016). */
const CATALOG_ROW = {
  kind: 'agency',
  moduleKey: null,
  resource: 'agency:work_transfer',
  action: 'write',
  label: 'Transfer work',
  description:
    'Hand a person’s open tickets, clients, leads and audits to a colleague — typically when someone leaves. Completed work stays credited to whoever did it.',
  group: 'Agency administration',
  sortOrder: 1016,
  assignableToUser: false,
  isDeprecated: false,
};

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const permissions = db.collection('permissions');
    if ((await permissions.estimatedDocumentCount()) === 0) {
      console.log(`${LOG} no permission catalog yet — nothing to grant`);
      return;
    }

    const now = new Date();
    await permissions.updateOne(
      { key: PERMISSION_KEY },
      {
        $set: { ...CATALOG_ROW, updatedAt: now },
        $setOnInsert: { key: PERMISSION_KEY, createdAt: now },
      },
      { upsert: true },
    );
    const permission = await permissions.findOne(
      { key: PERMISSION_KEY },
      { projection: { _id: 1 } },
    );

    const roles = await db
      .collection('roles')
      .find(
        { slug: AGENCY_OWNER_SLUG },
        { projection: { _id: 1, agencyId: 1 } },
      )
      .toArray();

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
      `${LOG} ${roles.length} Agency Owner role(s), granted '${PERMISSION_KEY}' to ${granted} that lacked it`,
    );
  },

  /**
   * Removes the grant from **every** role, including any an owner delegated it
   * to by hand. The catalog row is marked deprecated rather than deleted, per
   * the catalog's never-delete rule.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const result = await db
      .collection('rolePermissions')
      .deleteMany({ permissionKey: PERMISSION_KEY });
    await db
      .collection('permissions')
      .updateOne({ key: PERMISSION_KEY }, { $set: { isDeprecated: true } });

    console.log(
      `${LOG} removed '${PERMISSION_KEY}' from ${result.deletedCount} role(s)`,
    );
  },
};
