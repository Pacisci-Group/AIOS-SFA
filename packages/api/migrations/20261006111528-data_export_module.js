/**
 * PAC-152 — switch on the Data Export page for every existing agency.
 *
 * The first module key added to the platform since the scaffold, so it needs
 * three things a new *permission on an existing module* never did (compare
 * `20260923185801-management_read_for_branch_managers.js`, which this copies
 * for part (c)):
 *
 * - **(a) Catalog rows.** `data_export:read` / `data_export:write` must exist
 *   in `permissions` before any role can hold them — `setRolePermissions`
 *   refuses a key it cannot find, and only the seeds and `sync:roles` write
 *   this collection. The rows are exactly what `seedPermissions` would write
 *   from `PERMISSION_CATALOG`, so a later seed or sync finds them in place.
 * - **(b) The entitlement.** `resolvePermissionSet` drops every
 *   `{module}:*` string whose module the agency has not enabled, and only a
 *   super admin can enable one. Without this, the Data Team's new grant would
 *   be silently filtered away and the page would 403 for everyone, owner
 *   included. Written only where the key is absent, so a super admin who
 *   later switches the module off is not overridden by a retry.
 * - **(c) The Data Team grant.** `DEFAULT_ROLE_TEMPLATES` is consulted only
 *   when an agency is created; every existing `data_team` role keeps the rows
 *   it was seeded with. Read only — `:write` grants nothing on the page.
 *
 * The Agency Owner needs nothing: `grantsAllEnabledModules` expands every
 * enabled module, and (b) is what makes this one enabled.
 *
 * ## Idempotent
 *
 * Three upserts/conditional updates; a re-run matches what it wrote and
 * changes nothing. A failed run is not recorded and retries from the top.
 *
 * ## Cache
 *
 * A running API may hold resolved permission sets in Redis for up to
 * `PERMISSION_CACHE_TTL_SECONDS`, and a migration has no handle on that cache.
 * The TTL — or the user's next login — is the cutover, the same caveat
 * `sync-role-templates.ts` states. `ModuleGuard` reads the agency document
 * live, so the entitlement itself is immediate.
 *
 * ⚠ `npm run api:sync:roles` reproduces (a) and (c) but **not** (b): it never
 * touches `Agency.modules`. Only this migration enables the module on an
 * agency that predates it.
 *
 * ⚠ Every key, label and number is **copied in, not imported** from
 * `@sfa/shared`: no TypeScript build is in this path, and an applied
 * migration must keep doing in a year what it did today.
 */

/** Copied from `ModuleKey.DataExport`. */
const MODULE_KEY = 'data_export';
/** Copied from `DEFAULT_ROLE_TEMPLATES[].slug`. */
const DATA_TEAM_SLUG = 'data_team';
const READ_KEY = 'data_export:read';

/** Copied from `PAGES[]` (`permission-catalog.ts`) for `ModuleKey.DataExport`. */
const PAGE_DESCRIPTION =
  'Download report-ready datasets (leads, quotes, sold deals, policies, households, contacts) as CSV or Excel. View is all the page needs; Edit grants nothing further.';

/**
 * The rows `moduleDefinitions()` emits for this module
 * (`permission-catalog.definitions.ts`): the 14th module key, so sort orders
 * 130 / 131.
 */
const CATALOG_ROWS = [
  {
    key: READ_KEY,
    action: 'read',
    label: 'View Data Export',
    description: PAGE_DESCRIPTION,
    sortOrder: 130,
  },
  {
    key: 'data_export:write',
    action: 'write',
    label: 'Edit Data Export',
    description: `${PAGE_DESCRIPTION} Includes everything View grants.`,
    sortOrder: 131,
  },
];

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const now = new Date();

    // (a) Catalog rows — the same upsert `seedPermissions` runs.
    let catalogCreated = 0;
    for (const row of CATALOG_ROWS) {
      const result = await db.collection('permissions').updateOne(
        { key: row.key },
        {
          $set: {
            kind: 'module',
            moduleKey: MODULE_KEY,
            resource: MODULE_KEY,
            action: row.action,
            label: row.label,
            description: row.description,
            group: 'Pages',
            sortOrder: row.sortOrder,
            assignableToUser: true,
            isDeprecated: false,
            updatedAt: now,
          },
          $setOnInsert: { key: row.key, createdAt: now },
        },
        { upsert: true },
      );
      if (result.upsertedCount > 0) catalogCreated += 1;
    }

    // (b) Entitlement — only agencies that have never had the key.
    const entitled = await db.collection('agencies').updateMany(
      { [`modules.${MODULE_KEY}`]: { $exists: false } },
      { $set: { [`modules.${MODULE_KEY}`]: { enabled: true, enabledAt: now } } },
    );

    // (c) Data Team grant — byte-for-byte the management migration's loop.
    const permission = await db
      .collection('permissions')
      .findOne({ key: READ_KEY }, { projection: { _id: 1 } });
    const roles = await db
      .collection('roles')
      .find({ slug: DATA_TEAM_SLUG }, { projection: { _id: 1, agencyId: 1 } })
      .toArray();

    let granted = 0;
    for (const role of roles) {
      const result = await db.collection('rolePermissions').updateOne(
        { roleId: role._id, permissionKey: READ_KEY },
        {
          $set: {
            agencyId: role.agencyId,
            permissionId: permission._id,
            source: 'template',
            updatedAt: now,
          },
          $setOnInsert: {
            roleId: role._id,
            permissionKey: READ_KEY,
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
      `[data-export-module] catalog: ${catalogCreated} row(s) created; ` +
        `module enabled on ${entitled.modifiedCount} agenc${entitled.modifiedCount === 1 ? 'y' : 'ies'}; ` +
        `${roles.length} Data Team role(s), granted '${READ_KEY}' to ${granted} that lacked it`,
    );
  },

  /**
   * Reverses (c) and (b) and retires (a).
   *
   * - The Data Team grant is removed from **every** `data_team` role,
   *   including one an owner had added by hand — the row's `source` cannot
   *   tell them apart. Lossy in that one case; the next `up` restores it.
   * - The entitlement is removed only where it carries no `enabledBy`: a
   *   super admin's later toggle records one, and is left alone.
   * - The catalog rows are **deprecated, never deleted** — the catalog's rule
   *   (`permission-catalog.definitions.ts`), so nothing referencing them dangles.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const roleIds = await db
      .collection('roles')
      .find({ slug: DATA_TEAM_SLUG }, { projection: { _id: 1 } })
      .map((role) => role._id)
      .toArray();
    const revoked = await db
      .collection('rolePermissions')
      .deleteMany({ roleId: { $in: roleIds }, permissionKey: READ_KEY });

    const unentitled = await db.collection('agencies').updateMany(
      {
        [`modules.${MODULE_KEY}`]: { $exists: true },
        [`modules.${MODULE_KEY}.enabledBy`]: { $exists: false },
      },
      { $unset: { [`modules.${MODULE_KEY}`]: '' } },
    );

    const retired = await db.collection('permissions').updateMany(
      { key: { $in: CATALOG_ROWS.map((row) => row.key) } },
      { $set: { isDeprecated: true } },
    );

    console.log(
      `[data-export-module] revoked from ${revoked.deletedCount} Data Team role(s); ` +
        `module removed from ${unentitled.modifiedCount} agenc${unentitled.modifiedCount === 1 ? 'y' : 'ies'}; ` +
        `${retired.modifiedCount} catalog row(s) deprecated`,
    );
  },
};
