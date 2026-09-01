import { ALL_MODULE_KEYS, ModuleKey } from '../enums/module-key.enum';
import { allPagePermissionKeys, pageLevelMap } from './permission-catalog';
import {
  ALL_AGENCY_ADMIN_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
} from './permission.constants';
import { DataScope, DEFAULT_ROLE_TEMPLATES } from './default-role-templates';
import { resolvePermissionSet } from './resolve-permissions';

/**
 * Guardrail tests for the page-level permission model:
 *   - Every page is all-or-nothing with only `read` / `write` levels.
 *   - `write` always implies `read`.
 *   - The only permissions that exist are page `{module}:read|write` strings
 *     plus the owner-only admin permissions (`agency:*` / `platform:*`).
 * These fail fast if anyone reintroduces fine-grained permission strings.
 */
describe('page-level permission model', () => {
  const pagePermissions = new Set(allPagePermissionKeys());
  const adminPermissions = new Set<string>([
    ...ALL_AGENCY_ADMIN_PERMISSIONS,
    ...ALL_PLATFORM_PERMISSIONS,
  ]);
  const allowedPermissions = new Set<string>([
    ...pagePermissions,
    ...adminPermissions,
  ]);

  it('only exposes read/write levels per page', () => {
    for (const moduleKey of ALL_MODULE_KEYS) {
      expect(pagePermissions.has(`${moduleKey}:read`)).toBe(true);
      expect(pagePermissions.has(`${moduleKey}:write`)).toBe(true);
    }
    // No page permission carries an action other than read/write.
    for (const permission of pagePermissions) {
      const action = permission.split(':')[1];
      expect(action === 'read' || action === 'write').toBe(true);
    }
  });

  it('default role templates only use valid page or admin permissions', () => {
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      for (const permission of template.permissions) {
        expect(allowedPermissions.has(permission)).toBe(true);
      }
    }
  });

  /**
   * PAC-65 #9. The edit log is restricted to owners and managers, and the roles
   * that do the editing must not hold it. Asserted here rather than trusted to
   * review, because widening it is a one-line change in a file nobody re-reads.
   */
  describe('change-log permission', () => {
    const holder = (slug: string) =>
      DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === slug)!;

    it('is held by the Branch Manager', () => {
      expect(holder('branch_manager').permissions).toContain(
        'agency:changelogs:read',
      );
    });

    it('reaches the Agency Owner through the admin spread', () => {
      // Not via `grantsAllEnabledModules`, which only expands `{m}:read|write`.
      expect(holder('agency_owner').permissions).toContain(
        'agency:changelogs:read',
      );
    });

    it.each(['producer', 'csr', 'data_team'])(
      'is withheld from %s',
      (slug) => {
        expect(holder(slug).permissions).not.toContain(
          'agency:changelogs:read',
        );
      },
    );
  });

  it('grantsAllEnabledModules templates rely on modules, not extra strings', () => {
    // A template that auto-grants every enabled module must not also hardcode
    // page permission strings (those are derived from enabled modules instead).
    for (const template of DEFAULT_ROLE_TEMPLATES) {
      if (!template.grantsAllEnabledModules) {
        continue;
      }
      for (const permission of template.permissions) {
        expect(adminPermissions.has(permission)).toBe(true);
      }
    }
  });

  describe('CSR role template', () => {
    const csr = DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === 'csr');

    it('exists with own data scope', () => {
      expect(csr).toBeDefined();
      expect(csr!.dataScope).toBe(DataScope.Own);
    });

    it('resolves to exactly the expected page levels', () => {
      const resolved = resolvePermissionSet({
        rolePermissions: csr!.permissions,
      });
      const levels = pageLevelMap(resolved);

      const expected: Record<string, 'none' | 'read' | 'write'> = {
        [ModuleKey.Dashboard]: 'read',
        [ModuleKey.Leads]: 'write',
        [ModuleKey.Mailers]: 'write',
        [ModuleKey.Performance]: 'read',
        [ModuleKey.CrmService]: 'write',
        // Start Quote on the Household page: step 1 is a `leads` write, step 2
        // a `quote_recaps` write, and the CSR runs both.
        [ModuleKey.QuoteRecaps]: 'write',
        [ModuleKey.Clients]: 'none',
        [ModuleKey.DealAudits]: 'none',
        [ModuleKey.Onboardings]: 'none',
        [ModuleKey.Management]: 'none',
        [ModuleKey.OwnerDashboard]: 'none',
        [ModuleKey.CommandCenter]: 'none',
        [ModuleKey.Leaderboard]: 'none',
      };

      for (const moduleKey of ALL_MODULE_KEYS) {
        expect(levels[moduleKey]).toBe(expected[moduleKey]);
      }
    });

    it('grants write pages their implied read', () => {
      const resolved = new Set(
        resolvePermissionSet({ rolePermissions: csr!.permissions }),
      );
      for (const moduleKey of [
        ModuleKey.Leads,
        ModuleKey.Mailers,
        ModuleKey.CrmService,
        ModuleKey.QuoteRecaps,
      ]) {
        expect(resolved.has(`${moduleKey}:write`)).toBe(true);
        expect(resolved.has(`${moduleKey}:read`)).toBe(true);
      }
    });
  });

  describe('producer role template', () => {
    const producer = DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === 'producer');

    it('includes the Mailer page (read + write)', () => {
      expect(producer).toBeDefined();
      expect(producer!.permissions).toContain('mailers:read');
      expect(producer!.permissions).toContain('mailers:write');
    });
  });

  describe('resolvePermissionSet enforces write-implies-read', () => {
    it('adds read for every write in role permissions', () => {
      const result = resolvePermissionSet({
        rolePermissions: ['leads:write', 'clients:write'],
      });
      expect(result).toContain('leads:read');
      expect(result).toContain('clients:read');
    });

    it('adds read for writes granted via grantsAllEnabledModules', () => {
      const result = resolvePermissionSet({
        rolePermissions: [],
        grantsAllEnabledModules: true,
        enabledModules: ['leads', 'clients'],
      });
      const set = new Set(result);
      for (const permission of set) {
        if (permission.endsWith(':write')) {
          const moduleKey = permission.slice(0, -':write'.length);
          expect(set.has(`${moduleKey}:read`)).toBe(true);
        }
      }
    });

    it('keeps read when write survives a lone read revoke', () => {
      const result = resolvePermissionSet({
        rolePermissions: ['leads:write'],
        revokes: ['leads:read'],
      });
      const set = new Set(result);
      // Write cannot be granted without read: the surviving write re-adds read.
      expect(set.has('leads:write')).toBe(true);
      expect(set.has('leads:read')).toBe(true);
    });

    it('never yields a write without its matching read', () => {
      const result = resolvePermissionSet({
        rolePermissions: [
          'leads:write',
          'clients:read',
          'deal_audits:write',
        ],
        grants: ['mailers:write'],
        revokes: ['clients:read'],
      });
      const set = new Set(result);
      for (const permission of set) {
        if (permission.endsWith(':write')) {
          const moduleKey = permission.slice(0, -':write'.length);
          expect(set.has(`${moduleKey}:read`)).toBe(true);
        }
      }
    });
  });
});
