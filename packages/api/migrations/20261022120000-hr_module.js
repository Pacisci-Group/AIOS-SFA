/**
 * PAC-161 — switch on the HR module for every existing agency.
 *
 * The third module key added since the scaffold, built on
 * `20261007085957-analytics_module.js` and
 * `20261006120100-agency_settings_permission_grant.js` together, because this
 * one adds **both** kinds of permission: the module pair `hr:read` /
 * `hr:write`, and the admin pair `agency:hr:admin` / `agency:hr:export`.
 *
 * - **(a) Catalog rows** for all four. `setRolePermissions` refuses a key
 *   with no `permissions` row, and the Agency Owner template spreads every
 *   `AgencyPermission` — so without the two admin rows **Onboard Agency
 *   400s** ("Permission catalog is missing"), the PAC-149 lesson.
 * - **(b) The entitlement.** `resolvePermissionSet` drops every `hr:*`
 *   string whose module the agency has not enabled, and only a super admin
 *   can enable one. Written only where the key is absent.
 * - **(c) Grants.** `DEFAULT_ROLE_TEMPLATES` is consulted only when an agency
 *   is created. Branch Manager (the Office Manager) gets all four; the Agency
 *   Owner gets the two admin keys (the module pair reaches it through
 *   `grantsAllEnabledModules` once (b) is done); Producer, CSR, CRM and Data
 *   Team get `hr:read` — every account is an employee, and without it no
 *   existing employee could open HR at all.
 * - **(d) The calendar document** per agency that has none: the Mon–Fri
 *   workweek, country `US`, and the region read off the default branch's
 *   address through a copied state table. **No holiday rows** — a person
 *   ticks those (the onboarding step, the import dialog, a Q4 proposal);
 *   `date-holidays` marks Columbus Day `public` and most private employers
 *   are open. **No leave policy** — an agency may hold none (Asad,
 *   2026-10-22); that is the agency not using leave.
 *
 * ## Idempotent
 *
 * Upserts and existence-guarded inserts throughout; a re-run matches what it
 * wrote and changes nothing. A failed run is not recorded and retries from
 * the top.
 *
 * ## Cache
 *
 * A running API may hold resolved permission sets in Redis for up to
 * `PERMISSION_CACHE_TTL_SECONDS`; the TTL or the user's next login is the
 * cutover, as `sync-role-templates.ts` states. `ModuleGuard` reads the
 * agency document live, so the entitlement itself is immediate.
 *
 * ⚠ `npm run api:sync:roles` reproduces (a) and (c) but **not** (b) or (d).
 *
 * ⚠ Every key, label, number and the state table are **copied in, not
 * imported** from `@sfa/shared` / `date-holidays`: no TypeScript build is in
 * this path, and an applied migration must keep doing in a year what it did
 * today.
 */

/** Copied from `ModuleKey.Hr`. */
const MODULE_KEY = 'hr';

/** Copied from `PAGES[]` (`permission-catalog.ts`) for `ModuleKey.Hr`. */
const PAGE_DESCRIPTION =
  'Your own time off, attendance and leave rules, and the agency calendar. Edit lets a reviewer decide requests and record or classify attendance events for their branch.';

/**
 * The rows `moduleDefinitions()` emits: the 16th module key, so sort orders
 * 150 / 151.
 */
const MODULE_ROWS = [
  {
    key: 'hr:read',
    action: 'read',
    label: 'View HR',
    description: PAGE_DESCRIPTION,
    sortOrder: 150,
  },
  {
    key: 'hr:write',
    action: 'write',
    label: 'Edit HR',
    description: `${PAGE_DESCRIPTION} Includes everything View grants.`,
    sortOrder: 151,
  },
];

/**
 * The rows `adminDefinitions()` emits — `1000 + index` in
 * `Object.values(AgencyPermission)`, where the pair was appended last after
 * nineteen existing keys.
 */
const ADMIN_ROWS = [
  {
    key: 'agency:hr:admin',
    kind: 'agency',
    moduleKey: null,
    resource: 'agency:hr',
    action: 'admin',
    label: 'Administer HR',
    description:
      'Edit leave policies and the agency calendar, confirm holidays, open HR onboardings and correct balances and points.',
    group: 'Agency administration',
    sortOrder: 1019,
    assignableToUser: false,
    isDeprecated: false,
  },
  {
    key: 'agency:hr:export',
    kind: 'agency',
    moduleKey: null,
    resource: 'agency:hr',
    action: 'export',
    label: 'Export HR data',
    description:
      'Download HR datasets (requests, attendance, balances, points) through Data Export, with the same field restrictions as the screens.',
    group: 'Agency administration',
    sortOrder: 1020,
    assignableToUser: false,
    isDeprecated: false,
  },
];

/** Copied from `DEFAULT_ROLE_TEMPLATES[].slug` → the keys each gains. */
const GRANTS = {
  branch_manager: [
    'hr:read',
    'hr:write',
    'agency:hr:admin',
    'agency:hr:export',
  ],
  agency_owner: ['agency:hr:admin', 'agency:hr:export'],
  producer: ['hr:read'],
  csr: ['hr:read'],
  crm: ['hr:read'],
  data_team: ['hr:read'],
};

const ALL_KEYS = [...MODULE_ROWS, ...ADMIN_ROWS].map((row) => row.key);

/** Copied from `DEFAULT_WORKWEEK` (Sunday = 0) and `DEFAULT_CALENDAR_COUNTRY`. */
const DEFAULT_WORKWEEK = [1, 2, 3, 4, 5];
const DEFAULT_COUNTRY = 'US';

/**
 * `date-holidays`' US state table as of 3.37.0 — the codes the calendar's
 * `region` must hold. Copied so a branch address of "Oklahoma" or "ok" maps
 * to `OK` the way `regionFromStateName` does, without importing the package.
 */
const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

function regionFromState(text) {
  if (typeof text !== 'string') return null;
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  for (const [code, name] of Object.entries(US_STATES)) {
    if (code.toLowerCase() === needle || name.toLowerCase() === needle) {
      return code;
    }
  }
  return null;
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const now = new Date();
    const permissions = db.collection('permissions');

    // (a) Catalog rows — module rows as `seedPermissions` writes them,
    // admin rows `$setOnInsert` only (a seed or sync that got there first wins).
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
    for (const row of ADMIN_ROWS) {
      const result = await permissions.updateOne(
        { key: row.key },
        { $setOnInsert: { ...row, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
      if (result.upsertedCount > 0) catalogCreated += 1;
    }

    const catalog = await permissions
      .find({ key: { $in: ALL_KEYS } }, { projection: { _id: 1, key: 1 } })
      .toArray();
    const idByKey = new Map(catalog.map((row) => [row.key, row._id]));

    // (b) Entitlement — only agencies that have never had the key.
    const entitled = await db.collection('agencies').updateMany(
      { [`modules.${MODULE_KEY}`]: { $exists: false } },
      { $set: { [`modules.${MODULE_KEY}`]: { enabled: true, enabledAt: now } } },
    );

    // (c) Grants — byte-for-byte the precedent's loop, once per slug.
    let granted = 0;
    let rolesSeen = 0;
    for (const [slug, keys] of Object.entries(GRANTS)) {
      const roles = await db
        .collection('roles')
        .find({ slug }, { projection: { _id: 1, agencyId: 1 } })
        .toArray();
      rolesSeen += roles.length;
      for (const role of roles) {
        for (const key of keys) {
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

    // (d) The calendar document, for every agency that has none.
    let calendarsCreated = 0;
    const agencies = await db
      .collection('agencies')
      .find({}, { projection: { _id: 1 } })
      .toArray();
    for (const agency of agencies) {
      const agencyId = agency._id.toString();
      const existing = await db
        .collection('agencyCalendars')
        .findOne({ agencyId }, { projection: { _id: 1 } });
      if (existing) continue;
      const branch = await db
        .collection('branches')
        .findOne(
          { agencyId: agency._id, isDefault: true },
          { projection: { 'address.state': 1 } },
        );
      await db.collection('agencyCalendars').insertOne({
        agencyId,
        workweek: DEFAULT_WORKWEEK,
        country: DEFAULT_COUNTRY,
        region: regionFromState(branch && branch.address && branch.address.state),
        proposals: [],
        createdBy: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
      });
      calendarsCreated += 1;
    }

    console.log(
      `[hr-module] catalog: ${catalogCreated} row(s) created; ` +
        `module enabled on ${entitled.modifiedCount} agenc${entitled.modifiedCount === 1 ? 'y' : 'ies'}; ` +
        `${rolesSeen} template role(s), ${granted} grant(s) added; ` +
        `${calendarsCreated} calendar(s) created for ${agencies.length} agenc${agencies.length === 1 ? 'y' : 'ies'}`,
    );
  },

  /**
   * Reverses (c) and (b) and retires (a). Leaves (d) alone: the calendar
   * documents are data — an owner may have imported holidays into them — and
   * older code does not know the collection exists.
   *
   * - The grants are removed from every role of those six slugs, including
   *   one an owner had added by hand — the row's `source` cannot tell them
   *   apart. Lossy in that one case; the next `up` restores it.
   * - The entitlement is removed only where it carries no `enabledBy`: a
   *   super admin's later toggle records one, and is left alone.
   * - The catalog rows are **deprecated, never deleted** — the catalog's rule.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const roleIds = await db
      .collection('roles')
      .find({ slug: { $in: Object.keys(GRANTS) } }, { projection: { _id: 1 } })
      .map((role) => role._id)
      .toArray();
    const revoked = await db
      .collection('rolePermissions')
      .deleteMany({ roleId: { $in: roleIds }, permissionKey: { $in: ALL_KEYS } });

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
      `[hr-module] revoked ${revoked.deletedCount} grant(s) from ${roleIds.length} role(s); ` +
        `module removed from ${unentitled.modifiedCount} agenc${unentitled.modifiedCount === 1 ? 'y' : 'ies'}; ` +
        `${retired.modifiedCount} catalog row(s) deprecated; calendars left in place`,
    );
  },
};
