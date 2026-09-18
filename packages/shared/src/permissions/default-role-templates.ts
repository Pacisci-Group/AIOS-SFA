import { ModuleKey } from '../enums/module-key.enum';
import {
  AgencyPermission,
  modulePermission,
  permissionsForModule,
} from './permission.constants';

export enum DataScope {
  Own = 'own',
  Branch = 'branch',
  Agency = 'agency',
}

export interface DefaultRoleTemplate {
  name: string;
  slug: string;
  description: string;
  dataScope: DataScope;
  permissions: string[];
  /** When true, user gets read+write on every module enabled for the agency. */
  grantsAllEnabledModules?: boolean;
}

export const DEFAULT_ROLE_TEMPLATES: DefaultRoleTemplate[] = [
  {
    name: 'Agency Owner',
    slug: 'agency_owner',
    description: 'Full agency administration and all enabled modules.',
    dataScope: DataScope.Agency,
    permissions: [...Object.values(AgencyPermission)],
    grantsAllEnabledModules: true,
  },
  {
    name: 'Branch Manager',
    slug: 'branch_manager',
    description: 'Manage branch operations and view branch data.',
    dataScope: DataScope.Branch,
    permissions: [
      AgencyPermission.UsersRead,
      AgencyPermission.BranchesRead,
      AgencyPermission.ChangeLogsRead,
      ...permissionsForModule(ModuleKey.Leads),
      ...permissionsForModule(ModuleKey.Clients),
      ...permissionsForModule(ModuleKey.DealAudits),
      ...permissionsForModule(ModuleKey.Dashboard, ['read']),
      ...permissionsForModule(ModuleKey.Performance, ['read']),
      ...permissionsForModule(ModuleKey.Leaderboard, ['read']),
      modulePermission(ModuleKey.CrmService, 'read'),
      modulePermission(ModuleKey.CrmService, 'write'),
      modulePermission(ModuleKey.Mailers, 'read'),
    ],
  },
  {
    name: 'Producer',
    slug: 'producer',
    description: 'Sales producer — own leads and quoting.',
    dataScope: DataScope.Own,
    permissions: [
      modulePermission(ModuleKey.Dashboard, 'read'),
      ...permissionsForModule(ModuleKey.Leads),
      ...permissionsForModule(ModuleKey.QuoteRecaps),
      ...permissionsForModule(ModuleKey.Mailers),
      ...permissionsForModule(ModuleKey.DealAudits),
      modulePermission(ModuleKey.Clients, 'write'),
      modulePermission(ModuleKey.Performance, 'read'),
      modulePermission(ModuleKey.Leaderboard, 'read'),
    ],
  },
  {
    name: 'CSR',
    slug: 'csr',
    description:
      'Customer service representative — own producer pages plus CRM service.',
    dataScope: DataScope.Own,
    permissions: [
      modulePermission(ModuleKey.Dashboard, 'read'),
      ...permissionsForModule(ModuleKey.Leads),
      ...permissionsForModule(ModuleKey.Mailers),
      modulePermission(ModuleKey.Performance, 'read'),
      ...permissionsForModule(ModuleKey.CrmService),
      ...permissionsForModule(ModuleKey.QuoteRecaps),
    ],
  },
  {
    name: 'CRM',
    slug: 'crm',
    description: 'Client relation manager — branch clients, tickets and onboarding.',
    dataScope: DataScope.Branch,
    permissions: [
      modulePermission(ModuleKey.Dashboard, 'read'),
      modulePermission(ModuleKey.Clients, 'read'),
      modulePermission(ModuleKey.Clients, 'write'),
      modulePermission(ModuleKey.CrmService, 'read'),
      modulePermission(ModuleKey.CrmService, 'write'),
      modulePermission(ModuleKey.DealAudits, 'read'),
      modulePermission(ModuleKey.DealAudits, 'write'),
      /*
       * Leads (PAC-126) — because a **Company Transfer now starts with a lead**.
       *
       * A transfer used to be recorded on a CRM ticket. It now runs through the
       * ordinary Sold pipeline, which is anchored on a lead, so the CSR who
       * records one has to be able to create it: without `leads:write` the flow
       * 403s at its first step for exactly the person it exists for.
       *
       * `leads:read` rides along deliberately rather than being omitted as
       * unused. The Leads page and its nav entry are gated on it, and a role
       * that can create a record it cannot then open is a worse surface than one
       * extra page — the rep would have no way back to a lead they abandoned
       * mid-chain except the resume button on the policy.
       *
       * ⚠ **This does not reach existing agencies on its own.** Templates are
       * applied at provisioning; `seedDefaultRoles` union-upserts a change onto
       * roles that already exist, but nothing calls it for an agency nobody
       * re-seeds. Run `npm run sync:roles -w @sfa/api` after deploying, or every
       * migrated and panel-created agency's CSRs keep 403ing. Already-signed-in
       * users also keep their cached permission set until their next token
       * refresh.
       */
      modulePermission(ModuleKey.Leads, 'read'),
      modulePermission(ModuleKey.Leads, 'write'),
      modulePermission(ModuleKey.Onboardings, 'read'),
      modulePermission(ModuleKey.Onboardings, 'write'),
      modulePermission(ModuleKey.Mailers, 'read'),
    ],
  },
  {
    name: 'Data Team',
    slug: 'data_team',
    description: 'Agency-wide reporting and reconciliation.',
    dataScope: DataScope.Agency,
    permissions: [
      modulePermission(ModuleKey.Dashboard, 'read'),
      modulePermission(ModuleKey.CommandCenter, 'read'),
      modulePermission(ModuleKey.CommandCenter, 'write'),
      modulePermission(ModuleKey.Management, 'read'),
      modulePermission(ModuleKey.OwnerDashboard, 'read'),
      modulePermission(ModuleKey.Performance, 'read'),
      modulePermission(ModuleKey.Leaderboard, 'read'),
      modulePermission(ModuleKey.Mailers, 'read'),
    ],
  },
];
