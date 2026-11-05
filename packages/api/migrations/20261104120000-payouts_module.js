/**
 * PAC-176 / PAC-177 — switch on Payouts for every existing agency.
 *
 * Built on `20261007085957-analytics_module.js` (module pair + entitlement +
 * a role grant) and `20261006120100-agency_settings_permission_grant.js` (an
 * `agency:*` admin key granted to existing owners), because this one adds
 * **both** kinds of permission: the page pair `payouts:read` /
 * `payouts:write`, and the admin key `agency:payouts:admin`.
 *
 * - **(a) Catalog rows** for all three, exactly what `seedPermissions` would
 *   write from `PERMISSION_CATALOG`. `setRolePermissions` refuses a key with
 *   no `permissions` row, and the Agency Owner template spreads every
 *   `AgencyPermission` — without the admin row, **Onboard Agency 400s**
 *   ("Permission catalog is missing"), the PAC-149 lesson.
 * - **(b) The entitlement.** `resolvePermissionSet` drops every `payouts:*`
 *   string whose module the agency has not enabled, and only a super admin
 *   can enable one. Written only where the key is absent, so a super admin
 *   who later switches the module off is not overridden by a retry.
 * - **(c) Grants.** `DEFAULT_ROLE_TEMPLATES` is consulted only when an agency
 *   is created, so existing roles get them here: Branch Manager the page
 *   pair; Producer, CSR, CRM and Data Team `payouts:read` (own statements
 *   only, whatever the role's scope); the Agency Owner the admin key (the
 *   page pair reaches it through `grantsAllEnabledModules` once (b) is done).
 *
 * Skips (c) on a database whose catalog was never seeded (no
 * `agency:branding:read` row) — there are no roles worth granting to there.
 *
 * ## Idempotent
 *
 * Upserts and a conditional update; a re-run matches what it wrote and
 * changes nothing. A failed run is not recorded and retries from the top.
 *
 * ## Cache
 *
 * A running API may hold resolved permission sets in Redis for up to
 * `PERMISSION_CACHE_TTL_SECONDS`; the TTL or the user's next login is the
 * cutover. `ModuleGuard` reads the agency document live, so the entitlement
 * itself is immediate.
 *
 * ⚠ `npm run api:sync:roles` reproduces (a) and (c) but **not** (b).
 *
 * ⚠ Every key, label and number is **copied in, not imported** from
 * `@sfa/shared`: no TypeScript build is in this path, and an applied
 * migration must keep doing in a year what it did today.
 */

/** Copied from `ModuleKey.Payouts`. */
const MODULE_KEY = 'payouts';

/** Proves the catalog was seeded on this database at all. */
const SEEDED_MARKER_KEY = 'agency:branding:read';

/** Copied from `PAGES[]` (`permission-catalog.ts`) for `ModuleKey.Payouts`. */
const PAGE_DESCRIPTION =
  'Your own monthly commission statements: open, accept or dispute them. Edit lets a manager review, adjust and send the statements of the people in their scope.';

/**
 * The rows `moduleDefinitions()` emits for this module: the 17th module key,
 * so sort orders 160 / 161.
 */
const MODULE_ROWS = [
  {
    key: 'payouts:read',
    action: 'read',
    label: 'View Payouts',
    description: PAGE_DESCRIPTION,
    sortOrder: 160,
  },
  {
    key: 'payouts:write',
    action: 'write',
    label: 'Edit Payouts',
    description: `${PAGE_DESCRIPTION} Includes everything View grants.`,
    sortOrder: 161,
  },
];

/**
 * The row `adminDefinitions()` emits — `1000 + index` in
 * `Object.values(AgencyPermission)`, appended last after nineteen keys.
 */
const ADMIN_ROW = {
  key: 'agency:payouts:admin',
  kind: 'agency',
  moduleKey: null,
  resource: 'agency:payouts',
  action: 'admin',
  label: 'Administer payouts',
  description:
    'Set up payment structures and who is on them, the team bonus and Salesperson of the Month, import the carrier chargeback report and generate a month’s commission statements.',
  group: 'Agency administration',
  sortOrder: 1019,
  assignableToUser: false,
  isDeprecated: false,
};

/** Copied from `DEFAULT_ROLE_TEMPLATES[].slug` → the keys each gains. */
const GRANTS = {
  agency_owner: ['agency:payouts:admin'],
  branch_manager: ['payouts:read', 'payouts:write'],
  producer: ['payouts:read'],
  csr: ['payouts:read'],
  crm: ['payouts:read'],
  data_team: ['payouts:read'],
};

const ALL_KEYS = [...MODULE_ROWS.map((row) => row.key), ADMIN_ROW.key];

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const now = new Date();
    const permissions = db.collection('permissions');

    // (a) Catalog rows — the same upserts `seedPermissions` runs.
    let catalogCreated = 0;
    for (const row of MODULE_ROWS) {
      const result = await permissions.updateOne(
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
    {
      const { key, ...fields } = ADMIN_ROW;
      const result = await permissions.updateOne(
        { key },
        {
          $set: { ...fields, updatedAt: now },
          $setOnInsert: { key, createdAt: now },
        },
        { upsert: true },
      );
      if (result.upsertedCount > 0) catalogCreated += 1;
    }

    // (b) Entitlement — only agencies that have never had the key.
    const entitled = await db.collection('agencies').updateMany(
      { [`modules.${MODULE_KEY}`]: { $exists: false } },
      {
        $set: {
          [`modules.${MODULE_KEY}`]: { enabled: true, enabledAt: now },
        },
      },
    );

    // (c) Grants — skipped on a database whose catalog was never seeded.
    const seeded = await permissions.findOne(
      { key: SEEDED_MARKER_KEY },
      { projection: { _id: 1 } },
    );
    let granted = 0;
    let roleCount = 0;
    if (seeded) {
      const catalog = await permissions
        .find({ key: { $in: ALL_KEYS } }, { projection: { _id: 1, key: 1 } })
        .toArray();
      const idByKey = new Map(catalog.map((row) => [row.key, row._id]));

      const roles = await db
        .collection('roles')
        .find(
          { slug: { $in: Object.keys(GRANTS) } },
          { projection: { _id: 1, agencyId: 1, slug: 1 } },
        )
        .toArray();
      roleCount = roles.length;

      for (const role of roles) {
        for (const key of GRANTS[role.slug] ?? []) {
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
    }

    console.log(
      `[payouts-module] catalog: ${catalogCreated} row(s) created; ` +
        `module enabled on ${entitled.modifiedCount} agenc${entitled.modifiedCount === 1 ? 'y' : 'ies'}; ` +
        (seeded
          ? `${roleCount} template role(s), ${granted} grant(s) added`
          : `no '${SEEDED_MARKER_KEY}' catalog row — never seeded, no grants`),
    );
  },

  /**
   * Reverses (c) and (b) and retires (a).
   *
   * - The grants are removed from **every** role with a template slug,
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
    const roles = await db
      .collection('roles')
      .find({ slug: { $in: Object.keys(GRANTS) } }, { projection: { _id: 1 } })
      .toArray();
    const revoked = await db.collection('rolePermissions').deleteMany({
      roleId: { $in: roles.map((role) => role._id) },
      permissionKey: { $in: ALL_KEYS },
    });

    const unentitled = await db.collection('agencies').updateMany(
      {
        [`modules.${MODULE_KEY}`]: { $exists: true },
        [`modules.${MODULE_KEY}.enabledBy`]: { $exists: false },
      },
      { $unset: { [`modules.${MODULE_KEY}`]: '' } },
    );

    const retired = await db
      .collection('permissions')
      .updateMany({ key: { $in: ALL_KEYS } }, { $set: { isDeprecated: true } });

    console.log(
      `[payouts-module] revoked ${revoked.deletedCount} grant(s); ` +
        `module removed from ${unentitled.modifiedCount} ` +
        `agenc${unentitled.modifiedCount === 1 ? 'y' : 'ies'}; ` +
        `${retired.modifiedCount} catalog row(s) deprecated`,
    );
  },
};
