import { ALL_MODULE_KEYS } from '../enums/module-key.enum';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_BY_KEY,
  PERMISSION_CATALOG,
} from './permission-catalog.definitions';
import { allPagePermissionKeys } from './permission-catalog';
import {
  ALL_AGENCY_ADMIN_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
} from './permission.constants';

/**
 * The catalog is a *description* of the permission constants, not a second
 * source of them. These tests are what keeps that true.
 *
 * The failure they prevent is quiet: a permission added to the constants and
 * used in a `@RequirePermissions` decorator, but missing from the catalog, has
 * no row in the `permissions` collection — so no role can be granted it through
 * the UI and the endpoint 403s for everyone but the owner (who gets it from
 * `grantsAllEnabledModules`). Nothing errors; the page is just unreachable.
 */
describe('permission catalog parity', () => {
  const expectedKeys = [
    ...allPagePermissionKeys(),
    ...ALL_AGENCY_ADMIN_PERMISSIONS,
    ...ALL_PLATFORM_PERMISSIONS,
  ];

  it('covers exactly the permissions the constants define', () => {
    expect([...ALL_PERMISSION_KEYS].sort()).toEqual([...expectedKeys].sort());
  });

  it('has no duplicate keys', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
    expect(PERMISSION_BY_KEY.size).toBe(PERMISSION_CATALOG.length);
  });

  it('splits every key into a resource and action that rebuild it', () => {
    for (const definition of PERMISSION_CATALOG) {
      expect(`${definition.resource}:${definition.action}`).toBe(definition.key);
    }
  });

  it('sets moduleKey on module permissions and only on those', () => {
    for (const definition of PERMISSION_CATALOG) {
      if (definition.kind === 'module') {
        expect(ALL_MODULE_KEYS).toContain(definition.moduleKey);
        expect(definition.key.startsWith(`${definition.moduleKey}:`)).toBe(true);
      } else {
        expect(definition.moduleKey).toBeNull();
      }
    }
  });

  it('derives kind from the key namespace', () => {
    for (const definition of PERMISSION_CATALOG) {
      const expected = definition.key.startsWith('platform:')
        ? 'platform'
        : definition.key.startsWith('agency:')
          ? 'agency'
          : 'module';
      expect(definition.kind).toBe(expected);
    }
  });

  /**
   * Mirrors `assertPagePermissions` in `UsersService.updatePermissions`, which
   * has always refused per-user grants of `agency:*` / `platform:*`. If the two
   * ever disagree the UI offers a toggle the API rejects.
   */
  it('marks page permissions assignable to a user and admin ones not', () => {
    for (const definition of PERMISSION_CATALOG) {
      expect(definition.assignableToUser).toBe(definition.kind === 'module');
    }
  });

  it('gives every permission a label and a display group', () => {
    for (const definition of PERMISSION_CATALOG) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.group.length).toBeGreaterThan(0);
    }
  });

  it('orders module permissions before admin ones', () => {
    const lastModule = Math.max(
      ...PERMISSION_CATALOG.filter((d) => d.kind === 'module').map(
        (d) => d.sortOrder,
      ),
    );
    const firstAdmin = Math.min(
      ...PERMISSION_CATALOG.filter((d) => d.kind !== 'module').map(
        (d) => d.sortOrder,
      ),
    );
    expect(lastModule).toBeLessThan(firstAdmin);
  });
});
