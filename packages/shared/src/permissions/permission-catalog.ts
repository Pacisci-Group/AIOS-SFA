import { ALL_MODULE_KEYS, ModuleKey } from '../enums/module-key.enum';

/**
 * Simplified per-page permission model.
 *
 * Every page maps to a single {@link ModuleKey}. A user has one of three
 * levels per page:
 *   - `none`  — no access (page is hidden / API returns 403)
 *   - `read`  — can open the page and view everything on it (`{module}:read`)
 *   - `write` — read plus every write action on the page (`{module}:write`)
 *
 * `write` always implies `read`. The permission strings stored on roles and in
 * the JWT are the flat `{module}:read` / `{module}:write` values.
 */
export type PageLevel = 'none' | 'read' | 'write';

export interface PageDefinition {
  moduleKey: ModuleKey;
  /** Human-friendly page name shown in the permission matrix. */
  label: string;
  /** Short description of what the page contains. */
  description: string;
}

/** All pages an agency owner can grant access to, in display order. */
export const PAGES: PageDefinition[] = [
  {
    moduleKey: ModuleKey.Dashboard,
    label: 'Dashboard',
    description: 'The producer dashboard home shell and scorecards.',
  },
  {
    moduleKey: ModuleKey.Leads,
    label: 'Leads',
    description: 'Priority contact list and lead records.',
  },
  {
    moduleKey: ModuleKey.QuoteRecaps,
    label: 'Quote Recaps',
    description: 'Quote recap documents and files.',
  },
  {
    moduleKey: ModuleKey.Mailers,
    label: 'Mailers',
    description: 'Marketing mailers and campaigns.',
  },
  {
    moduleKey: ModuleKey.CrmService,
    label: 'CRM & Service',
    description: 'Service dashboard and ticket workspace.',
  },
  {
    moduleKey: ModuleKey.Clients,
    label: 'Clients',
    description: 'Households, contacts and deals.',
  },
  {
    moduleKey: ModuleKey.DealAudits,
    label: 'Deal Audits',
    description: 'Deals pending service hand-off and resolution.',
  },
  {
    moduleKey: ModuleKey.Onboardings,
    label: 'Onboardings',
    description: 'New client onboarding workflows.',
  },
  {
    moduleKey: ModuleKey.Management,
    label: 'Management Dashboard',
    description: 'Agency management analytics.',
  },
  {
    moduleKey: ModuleKey.OwnerDashboard,
    label: 'Owner Dashboard',
    description: 'Owner-level overview.',
  },
  {
    moduleKey: ModuleKey.CommandCenter,
    label: 'Command Center',
    description: 'Agency-wide reconciliation and reporting.',
  },
  {
    moduleKey: ModuleKey.Performance,
    label: 'Performance',
    description: 'Performance scorecards.',
  },
  {
    moduleKey: ModuleKey.Leaderboard,
    label: 'Leaderboard',
    description: 'Office leaderboard and motivation hub.',
  },
];

export interface PageLevelOverride {
  moduleKey: string;
  level: PageLevel;
}

/** Expand a page level into the permission strings it grants. */
export function pageLevelToPermissions(
  moduleKey: string,
  level: PageLevel,
): string[] {
  if (level === 'write') {
    return [`${moduleKey}:read`, `${moduleKey}:write`];
  }
  if (level === 'read') {
    return [`${moduleKey}:read`];
  }
  return [];
}

/** Resolve the effective level for a page from a permission set. */
export function permissionsToPageLevel(
  permissions: Iterable<string>,
  moduleKey: string,
): PageLevel {
  const set =
    permissions instanceof Set ? permissions : new Set<string>(permissions);
  if (set.has(`${moduleKey}:write`)) {
    return 'write';
  }
  if (set.has(`${moduleKey}:read`)) {
    return 'read';
  }
  return 'none';
}

/** Build a `{ moduleKey: level }` map for every page from a permission set. */
export function pageLevelMap(
  permissions: Iterable<string>,
): Record<string, PageLevel> {
  const set =
    permissions instanceof Set ? permissions : new Set<string>(permissions);
  const map: Record<string, PageLevel> = {};
  for (const moduleKey of ALL_MODULE_KEYS) {
    map[moduleKey] = permissionsToPageLevel(set, moduleKey);
  }
  return map;
}

/** Every page permission string (`{module}:read` / `{module}:write`). */
export function allPagePermissionKeys(): string[] {
  return ALL_MODULE_KEYS.flatMap((moduleKey) => [
    `${moduleKey}:read`,
    `${moduleKey}:write`,
  ]);
}

/**
 * Normalize a legacy fine-grained permission string into simplified page
 * permissions. Used when migrating existing data.
 *   `{module}:access` / `{module}:view:*`  -> `{module}:read`
 *   `{module}:manage|contact|resolve|...`  -> `{module}:read` + `{module}:write`
 */
export function normalizeLegacyPermission(permission: string): string[] {
  if (
    permission.startsWith('platform:') ||
    permission.startsWith('agency:')
  ) {
    return [permission];
  }

  const parts = permission.split(':');
  const moduleKey = parts[0];
  const action = parts[1];
  if (!moduleKey || !action) {
    return [];
  }

  if (action === 'read') {
    return [`${moduleKey}:read`];
  }
  if (action === 'write') {
    return [`${moduleKey}:read`, `${moduleKey}:write`];
  }
  if (action === 'access' || action === 'view') {
    return [`${moduleKey}:read`];
  }
  // Any other action (manage, contact, resolve, etc.) is a write capability.
  return [`${moduleKey}:read`, `${moduleKey}:write`];
}
