/**
 * Dash Reconciliation — switch the page on for every existing agency.
 *
 * The third module key added since the scaffold. A copy of
 * `20261007085957-analytics_module.js` with its constants swapped and its
 * role-grant step **removed**: no default role template carries this module.
 * The page belongs to the agency owner, who holds every enabled module through
 * `grantsAllEnabledModules`, and who can grant it to anyone else from the role
 * matrix once the catalog rows exist.
 *
 * - **(a) Catalog rows.** `carrier_reconciliation:read` / `:write` must exist
 *   in `permissions` before any role can hold them — `setRolePermissions`
 *   refuses a key it cannot find, and only the seeds and `sync:roles` write
 *   this collection. The rows are exactly what `seedPermissions` would write
 *   from `PERMISSION_CATALOG`, so a later seed or sync finds them in place.
 * - **(b) The entitlement.** `resolvePermissionSet` drops every `{module}:*`
 *   string whose module the agency has not enabled, and only a super admin can
 *   enable one. Without this the owner's page would 403. Written only where the
 *   key is absent, so a super admin who later switches the module off is not
 *   overridden by a retry.
 *
 * ## Idempotent
 *
 * Upserts and a conditional update; a re-run matches what it wrote and
 * changes nothing. A failed run is not recorded and retries from the top.
 *
 * ## Cache
 *
 * A running API may hold resolved permission sets in Redis for up to
 * `PERMISSION_CACHE_TTL_SECONDS`. The TTL — or the user's next login — is the
 * cutover. `ModuleGuard` reads the agency document live, so the entitlement
 * itself is immediate.
 *
 * ⚠ Every key, label and number is **copied in, not imported** from
 * `@sfa/shared`: no TypeScript build is in this path, and an applied
 * migration must keep doing in a year what it did today.
 */

/** Copied from `ModuleKey.CarrierReconciliation`. */
const MODULE_KEY = 'carrier_reconciliation';

/** Copied from `PAGES[]` (`permission-catalog.ts`) for `ModuleKey.CarrierReconciliation`. */
const PAGE_DESCRIPTION =
  "Reconcile the carrier's monthly new-business report against the agency's sales: policies missing from the app, app policies the carrier does not show, 1-800 policies for review and producer-credit mismatches. Edit uploads reports, reviews rows and re-checks a run against the staff's Allstate codes.";

/**
 * The rows `moduleDefinitions()` emits for this module
 * (`permission-catalog.definitions.ts`): the 16th module key, so sort orders
 * 150 / 151.
 */
const CATALOG_ROWS = [
  {
    key: 'carrier_reconciliation:read',
    action: 'read',
    label: 'View Dash Reconciliation',
    description: PAGE_DESCRIPTION,
    sortOrder: 150,
  },
  {
    key: 'carrier_reconciliation:write',
    action: 'write',
    label: 'Edit Dash Reconciliation',
    description: `${PAGE_DESCRIPTION} Includes everything View grants.`,
    sortOrder: 151,
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

    console.log(
      `[carrier-reconciliation-module] catalog: ${catalogCreated} row(s) created; ` +
        `module enabled on ${entitled.modifiedCount} agenc${entitled.modifiedCount === 1 ? 'y' : 'ies'}`,
    );
  },

  /**
   * Reverses (b) and retires (a).
   *
   * - The entitlement is removed only where it carries no `enabledBy`: a
   *   super admin's later toggle records one, and is left alone.
   * - The catalog rows are **deprecated, never deleted** — the catalog's rule
   *   (`permission-catalog.definitions.ts`), so a grant an owner made by hand
   *   does not dangle.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
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
      `[carrier-reconciliation-module] module removed from ${unentitled.modifiedCount} ` +
        `agenc${unentitled.modifiedCount === 1 ? 'y' : 'ies'}; ` +
        `${retired.modifiedCount} catalog row(s) deprecated`,
    );
  },
};
