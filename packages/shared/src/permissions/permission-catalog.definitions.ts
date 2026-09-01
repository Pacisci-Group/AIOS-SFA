import { ALL_MODULE_KEYS, ModuleKey } from '../enums/module-key.enum';
import { PAGES } from './permission-catalog';
import {
  AgencyPermission,
  ALL_AGENCY_ADMIN_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  modulePermission,
} from './permission.constants';

/**
 * The permission vocabulary as data, for the `permissions` collection.
 *
 * ## Why the catalog is a collection at all
 *
 * The 39 permission strings are the contract for 91 guard decorators across 21
 * controllers and 28 web files. That contract is code, and it stays code — this
 * file does not invent permissions, it *describes* the ones the constants
 * already define, so that a relational model has something for
 * `rolePermissions` and `userPermissions` to point at, and so the permission
 * matrix can render a label and a description instead of a raw string.
 *
 * ## Why the rows carry no `agencyId`
 *
 * A per-agency catalog would let configuration delete a permission the code
 * still requires — a `@RequirePermissions('leads:read')` that no row backs
 * denies everyone, silently. Per-tenant entitlement is already expressed
 * elsewhere, as `agency.modules[key].enabled`, and applied by
 * `resolvePermissionSet`'s module filter. One source of truth for "does this
 * permission exist", another for "is it available here".
 *
 * `carriers` seeds the same way and for the same reason.
 *
 * ## Deprecation, never deletion
 *
 * A key dropped from the constants must be marked `isDeprecated` rather than
 * removed: `rolePermissions` rows may still reference it, and a dangling
 * reference is worse than a row nobody grants.
 */
export type PermissionKind = 'module' | 'agency' | 'platform';

export interface PermissionDefinition {
  /** The permission string. Immutable — it is what the guards compare against. */
  key: string;
  kind: PermissionKind;
  /** Set only for `kind: 'module'`; the page the permission gates. */
  moduleKey: ModuleKey | null;
  /** Everything before the final colon. `leads`, `agency:users`, `platform`. */
  resource: string;
  /** The final colon segment. `read`, `write`, `permissions`, `toggle`. */
  action: string;
  label: string;
  description: string;
  /** Display grouping for the permission matrix. */
  group: string;
  sortOrder: number;
  /**
   * Whether an owner may grant or revoke this on an individual user.
   *
   * Only page permissions are. Admin capabilities (`agency:*`, `platform:*`)
   * come from role membership alone — matching `assertPagePermissions` in
   * `UsersService.updatePermissions`, which has always refused them.
   */
  assignableToUser: boolean;
}

/**
 * `agency:users:permissions` -> resource `agency:users`, action `permissions`.
 * `leads:read`               -> resource `leads`,        action `read`.
 *
 * Splitting on the LAST colon rather than the first is what lets one rule cover
 * both the two-segment page strings and the three-segment admin ones.
 */
function splitKey(key: string): { resource: string; action: string } {
  const at = key.lastIndexOf(':');
  return at === -1
    ? { resource: key, action: '' }
    : { resource: key.slice(0, at), action: key.slice(at + 1) };
}

function titleCase(segment: string): string {
  return segment
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const PAGE_BY_MODULE = new Map(PAGES.map((page) => [page.moduleKey, page]));

/**
 * Labels for the admin capabilities. Written out rather than derived: these are
 * the 13 permissions with no UI at all today, so the wording is the entire
 * difference between a usable role editor and a list of colon-separated
 * strings.
 */
const ADMIN_COPY: Record<string, { label: string; description: string }> = {
  [AgencyPermission.RolesRead]: {
    label: 'View roles',
    description: 'See the agency’s roles and the permissions each one grants.',
  },
  [AgencyPermission.RolesWrite]: {
    label: 'Manage roles',
    description:
      'Create, edit and delete roles, and change what each role grants.',
  },
  [AgencyPermission.UsersRead]: {
    label: 'View users',
    description: 'See the agency’s people, their roles and their status.',
  },
  [AgencyPermission.UsersWrite]: {
    label: 'Manage users',
    description:
      'Invite people, change their roles, and deactivate or restore them.',
  },
  [AgencyPermission.UsersPermissions]: {
    label: 'Manage user permissions',
    description:
      'Grant or revoke individual permissions on top of a person’s roles.',
  },
  [AgencyPermission.BranchesRead]: {
    label: 'View branches',
    description: 'See the agency’s branches.',
  },
  [AgencyPermission.BranchesWrite]: {
    label: 'Manage branches',
    description: 'Create, rename and reorganise branches.',
  },
  [AgencyPermission.ChangeLogsRead]: {
    label: 'View change history',
    description: 'See who changed a record and what they changed.',
  },
};

function moduleDefinitions(): PermissionDefinition[] {
  const rows: PermissionDefinition[] = [];
  ALL_MODULE_KEYS.forEach((moduleKey, index) => {
    const page = PAGE_BY_MODULE.get(moduleKey);
    const label = page?.label ?? titleCase(moduleKey);
    const description = page?.description ?? '';
    (['read', 'write'] as const).forEach((action, offset) => {
      const key = modulePermission(moduleKey, action);
      rows.push({
        key,
        kind: 'module',
        moduleKey,
        ...splitKey(key),
        label: action === 'read' ? `View ${label}` : `Edit ${label}`,
        description:
          action === 'read'
            ? description
            : `${description} Includes everything View grants.`,
        group: 'Pages',
        sortOrder: index * 10 + offset,
        assignableToUser: true,
      });
    });
  });
  return rows;
}

function adminDefinitions(): PermissionDefinition[] {
  return ALL_AGENCY_ADMIN_PERMISSIONS.map((key, index) => {
    const copy = ADMIN_COPY[key];
    const { resource, action } = splitKey(key);
    return {
      key,
      kind: 'agency' as const,
      moduleKey: null,
      resource,
      action,
      label: copy?.label ?? titleCase(`${action} ${resource}`),
      description: copy?.description ?? '',
      group: 'Agency administration',
      sortOrder: 1000 + index,
      assignableToUser: false,
    };
  });
}

function platformDefinitions(): PermissionDefinition[] {
  return ALL_PLATFORM_PERMISSIONS.map((key, index) => {
    const { resource, action } = splitKey(key);
    return {
      key,
      kind: 'platform' as const,
      moduleKey: null,
      resource,
      action,
      label: titleCase(`${action} ${resource.replace('platform:', '')}`),
      description: 'Platform operation, above the tenant boundary.',
      group: 'Platform',
      sortOrder: 2000 + index,
      assignableToUser: false,
    };
  });
}

/**
 * Every permission the system recognises, in display order.
 *
 * `permission-catalog-parity.spec.ts` pins this to the constants, so a
 * permission added to `permission.constants.ts` without a catalog entry (or the
 * reverse) fails the build rather than surfacing as a role editor that silently
 * cannot grant it.
 */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  ...moduleDefinitions(),
  ...adminDefinitions(),
  ...platformDefinitions(),
];

export const PERMISSION_BY_KEY: ReadonlyMap<string, PermissionDefinition> =
  new Map(PERMISSION_CATALOG.map((definition) => [definition.key, definition]));

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map(
  (definition) => definition.key,
);
