/**
 * PAC-149 — every Agency Owner role gains `agency:settings:read` and
 * `agency:settings:write`, the new pair gating `/settings/agency` (the time
 * zone and the end-of-day Away hour), which moved off `agency:branding:*`.
 *
 * ## Why a migration and not `npm run api:sync:roles`
 *
 * `DEFAULT_ROLE_TEMPLATES` is only consulted when an agency is *created*, so
 * every existing owner would lose the page the moment it shipped — the PAC-133
 * lock-out — until somebody ran the sync on every environment. Worse, onboarding
 * a *new* agency would fail outright: the owner template now names two keys
 * with no `permissions` catalog row, and `RoleAssignmentsService
 * .setRolePermissions` refuses a key it cannot resolve ("Permission catalog is
 * missing"). The API applies pending migrations at boot, so this one ships with
 * the code that needs it. Same shape as
 * `management_read_for_branch_managers` (PAC-139 §7).
 *
 * ## What it writes
 *
 * 1. **The two catalog rows**, which only the seeds and the sync script write
 *    otherwise. `$setOnInsert` only: if a seed or a sync got there first, its
 *    values (derived from the constants at the time) win.
 * 2. **One `rolePermissions` row per Agency Owner role per key**, upserted on
 *    the unique `{ roleId, permissionKey }` index — so a re-run changes
 *    nothing, and an owner role that somehow already holds a key keeps its row.
 *    `RoleAssignmentsService` is this collection's only writer at *runtime*,
 *    for its cache invalidation and owner-protection checks; a migration runs
 *    before the API serves a request, which is why the precedent does it too.
 *
 * Nobody else is granted anything. Roles that hold `agency:branding:*` today
 * — an owner may have delegated branding — deliberately do *not* inherit the
 * new pair: not handing over the clock along with the logo is the point.
 *
 * ## Skips a database that was never seeded
 *
 * No `agency:branding:read` catalog row means the core seed has not run, so
 * there is no catalog and no agency to fix; the seed will write both from the
 * constants and the template, which already carry the pair.
 *
 * ## Cache
 *
 * A running API may hold the old permission set in its Redis cache for up to
 * `PERMISSION_CACHE_TTL_SECONDS`, and a signed-in owner's browser keeps the
 * `user` blob from their last login in `localStorage` — the Agency card shows
 * up after their next token refresh or login. Same caveat
 * `sync-role-templates.ts` states.
 *
 * ⚠ The role slug, keys and catalog copy are **copied in, not imported** from
 * `@sfa/shared`: no TypeScript build is in this path, and an applied migration
 * must keep doing in a year what it did today.
 */

/** Copied from `DEFAULT_ROLE_TEMPLATES[].slug` (`@sfa/shared`). */
const AGENCY_OWNER_SLUG = 'agency_owner';

/** Proves the catalog was seeded on this database at all. */
const SEEDED_MARKER_KEY = 'agency:branding:read';

/**
 * Copied from `PERMISSION_CATALOG` (`@sfa/shared`) as of PAC-149 — the shape
 * `seedPermissions` writes. `sortOrder` is `1000 + index` in
 * `Object.values(AgencyPermission)`, where the pair was appended last.
 */
const CATALOG_ROWS = [
  {
    key: 'agency:settings:read',
    kind: 'agency',
    moduleKey: null,
    resource: 'agency:settings',
    action: 'read',
    label: 'View agency settings',
    description:
      'See the agency’s working day: its time zone and the hour everyone is set Away.',
    group: 'Agency administration',
    sortOrder: 1016,
    assignableToUser: false,
    isDeprecated: false,
  },
  {
    key: 'agency:settings:write',
    kind: 'agency',
    moduleKey: null,
    resource: 'agency:settings',
    action: 'write',
    label: 'Manage agency settings',
    description:
      'Change the agency’s time zone, which every dashboard’s day is cut on, and the hour everyone in the agency is set Away each night.',
    group: 'Agency administration',
    sortOrder: 1017,
    assignableToUser: false,
    isDeprecated: false,
  },
];

const PERMISSION_KEYS = CATALOG_ROWS.map((row) => row.key);

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const permissions = db.collection('permissions');

    const seeded = await permissions.findOne(
      { key: SEEDED_MARKER_KEY },
      { projection: { _id: 1 } },
    );
    if (!seeded) {
      console.log(
        `[agency-settings] no '${SEEDED_MARKER_KEY}' catalog row — never seeded, nothing to grant`,
      );
      return;
    }

    const now = new Date();
    let catalogCreated = 0;
    for (const row of CATALOG_ROWS) {
      const result = await permissions.updateOne(
        { key: row.key },
        { $setOnInsert: { ...row, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
      if (result.upsertedCount > 0) catalogCreated += 1;
    }

    const catalog = await permissions
      .find(
        { key: { $in: PERMISSION_KEYS } },
        { projection: { _id: 1, key: 1 } },
      )
      .toArray();
    const idByKey = new Map(catalog.map((row) => [row.key, row._id]));

    const roles = await db
      .collection('roles')
      .find(
        { slug: AGENCY_OWNER_SLUG },
        { projection: { _id: 1, agencyId: 1 } },
      )
      .toArray();

    let granted = 0;
    for (const role of roles) {
      for (const key of PERMISSION_KEYS) {
        const result = await db.collection('rolePermissions').updateOne(
          { roleId: role._id, permissionKey: key },
          {
            $set: {
              agencyId: role.agencyId,
              permissionId: idByKey.get(key),
              source: 'template',
              updatedAt: now,
            },
            $setOnInsert: {
              roleId: role._id,
              permissionKey: key,
              createdBy: null,
              updatedBy: null,
              createdAt: now,
            },
          },
          { upsert: true },
        );
        if (result.upsertedCount > 0) granted += 1;
      }
    }

    console.log(
      `[agency-settings] catalog: ${catalogCreated} row(s) created; ` +
        `${roles.length} Agency Owner role(s), ${granted} grant(s) added`,
    );
  },

  /**
   * Removes both keys from **every** Agency Owner role. The catalog rows stay:
   * an owner may have granted the pair to a custom role meanwhile, and those
   * rows must not dangle — older code's `seedPermissions` marks keys it does
   * not know `isDeprecated`, which is the catalog's own rule for a retired key.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const roleIds = await db
      .collection('roles')
      .find({ slug: AGENCY_OWNER_SLUG }, { projection: { _id: 1 } })
      .map((role) => role._id)
      .toArray();

    const result = await db.collection('rolePermissions').deleteMany({
      roleId: { $in: roleIds },
      permissionKey: { $in: PERMISSION_KEYS },
    });

    console.log(
      `[agency-settings] removed ${result.deletedCount} grant(s) from ${roleIds.length} Agency Owner role(s)`,
    );
  },
};
