/**
 * PAC-169 — every Agency Owner and Branch Manager role gains
 * `agency:hr:team_calendar`, the permission that puts **other people's**
 * time off on the HR calendar (`/calendar`). The page itself is behind
 * `hr:read`, which every role already holds; this key is what widens it from
 * "my own leave" to the team's.
 *
 * ## Why a migration and not `npm run api:sync:roles`
 *
 * `DEFAULT_ROLE_TEMPLATES` is only consulted when an agency is *created*, so
 * without this every existing owner and office manager would open the new
 * calendar and see nobody's leave but their own until somebody ran the sync
 * on every environment. Worse, onboarding a *new* agency would fail outright:
 * both templates now name a key with no `permissions` catalog row, and
 * `RoleAssignmentsService.setRolePermissions` refuses a key it cannot resolve
 * ("Permission catalog is missing") — the PAC-149 lesson. The API applies
 * pending migrations at boot, so this one ships with the code that needs it.
 * Same shape as `20261006120100-agency_settings_permission_grant.js`.
 *
 * ## What it writes
 *
 * 1. **The catalog row**, which only the seeds and the sync script write
 *    otherwise. `$setOnInsert` for everything but `isDeprecated`: if a seed
 *    or a sync got there first, its values (derived from the constants at the
 *    time) win. `isDeprecated: false` is set either way, so an `up` after a
 *    `down` un-retires the row.
 * 2. **One `rolePermissions` row per Agency Owner and Branch Manager role**,
 *    upserted on the unique `{ roleId, permissionKey }` index — so a re-run
 *    changes nothing, and a role that somehow already holds the key keeps its
 *    row. `RoleAssignmentsService` is this collection's only writer at
 *    *runtime*, for its cache invalidation and owner-protection checks; a
 *    migration runs before the API serves a request, which is why the
 *    precedents do it too.
 *
 * Nobody else is granted anything. A custom role, and the Producer / CSR /
 * CRM / Data Team templates, do not gain it: seeing a colleague's leave is
 * the thing being gated (Asad, 2026-11-06 — a dedicated permission, on the
 * owner and the office manager by default). An owner adds it to any other
 * role by hand from Roles & Permissions.
 *
 * ## Skips a database that was never seeded
 *
 * No `agency:branding:read` catalog row means the core seed has not run, so
 * there is no catalog and no agency to fix; the seed will write the row from
 * the constants and the templates, which already carry the key.
 *
 * ## Cache
 *
 * A running API may hold the old permission set in its Redis cache for up to
 * `PERMISSION_CACHE_TTL_SECONDS`, and a signed-in browser keeps the `user`
 * blob from its last login in `localStorage` — the team's leave shows up
 * after the next token refresh or login. Same caveat
 * `sync-role-templates.ts` states.
 *
 * ⚠ The role slugs, key and catalog copy are **copied in, not imported** from
 * `@sfa/shared`: no TypeScript build is in this path, and an applied migration
 * must keep doing in a year what it did today.
 */

/** Copied from `DEFAULT_ROLE_TEMPLATES[].slug` (`@sfa/shared`). */
const ROLE_SLUGS = ['agency_owner', 'branch_manager'];

/** Proves the catalog was seeded on this database at all. */
const SEEDED_MARKER_KEY = 'agency:branding:read';

/**
 * Copied from `PERMISSION_CATALOG` (`@sfa/shared`) as of PAC-169 — the shape
 * `seedPermissions` writes. `sortOrder` is `1000 + index` in
 * `Object.values(AgencyPermission)`, where the key was appended last
 * (`agency:hr:export` is 1020).
 */
const CATALOG_ROW = {
  key: 'agency:hr:team_calendar',
  kind: 'agency',
  moduleKey: null,
  resource: 'agency:hr',
  action: 'team_calendar',
  label: 'View team calendar',
  description:
    'See other people’s time off on the HR calendar: the whole agency for a role with agency-wide data, their own branch for a branch role. Pending requests also need Edit on HR.',
  group: 'Agency administration',
  sortOrder: 1021,
  assignableToUser: false,
  isDeprecated: false,
};

const PERMISSION_KEY = CATALOG_ROW.key;

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
        `[hr-team-calendar] no '${SEEDED_MARKER_KEY}' catalog row — never seeded, nothing to grant`,
      );
      return;
    }

    const now = new Date();
    // `isDeprecated` is the one field set on an existing row too: `down`
    // retires the row rather than deleting it, and an `up` after that must
    // bring it back, or the grants below would point at a retired key.
    const { isDeprecated, ...insertOnly } = CATALOG_ROW;
    const created = await permissions.updateOne(
      { key: PERMISSION_KEY },
      {
        $set: { isDeprecated },
        $setOnInsert: { ...insertOnly, createdAt: now, updatedAt: now },
      },
      { upsert: true },
    );

    const catalogRow = await permissions.findOne(
      { key: PERMISSION_KEY },
      { projection: { _id: 1 } },
    );

    const roles = await db
      .collection('roles')
      .find(
        { slug: { $in: ROLE_SLUGS } },
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
            permissionId: catalogRow._id,
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
      `[hr-team-calendar] catalog: ${created.upsertedCount} row(s) created; ` +
        `${roles.length} Agency Owner / Branch Manager role(s), ${granted} grant(s) added`,
    );
  },

  /**
   * Removes the key from **every** Agency Owner and Branch Manager role —
   * including one an owner re-added by hand; the row's `source` cannot tell
   * them apart, and the next `up` restores it. The catalog row is
   * **deprecated, never deleted**: an owner may have put the key on a custom
   * role meanwhile, and that row must not dangle — the catalog's own rule
   * for a retired key.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const roleIds = await db
      .collection('roles')
      .find({ slug: { $in: ROLE_SLUGS } }, { projection: { _id: 1 } })
      .map((role) => role._id)
      .toArray();

    const revoked = await db.collection('rolePermissions').deleteMany({
      roleId: { $in: roleIds },
      permissionKey: PERMISSION_KEY,
    });

    const retired = await db
      .collection('permissions')
      .updateOne({ key: PERMISSION_KEY }, { $set: { isDeprecated: true } });

    console.log(
      `[hr-team-calendar] removed ${revoked.deletedCount} grant(s) from ${roleIds.length} role(s); ` +
        `${retired.modifiedCount} catalog row(s) deprecated`,
    );
  },
};
