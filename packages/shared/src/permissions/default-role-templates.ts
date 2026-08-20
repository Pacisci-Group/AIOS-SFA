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

/** Fixed system role templates — permissions are not editable by agency owners. */
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
      // PAC-65 #9. A manager is half the audience for the quote/sold edit log —
      // the Agency Owner is the other half and gets it from the spread above.
      // Producer, CSR, CRM and Data Team are excluded on purpose: the log exists
      // because the people doing the editing should not be the only ones who
      // can see what was edited.
      AgencyPermission.ChangeLogsRead,
      ...permissionsForModule(ModuleKey.Leads),
      ...permissionsForModule(ModuleKey.Clients),
      ...permissionsForModule(ModuleKey.DealAudits),
      ...permissionsForModule(ModuleKey.Dashboard, ['read']),
      ...permissionsForModule(ModuleKey.Performance, ['read']),
      // Added by PAC-13. A Branch Manager already holds `dashboard:read` and
      // can therefore open the Producer Dashboard — without this, the Motivation
      // Hub on that page 403s for them while every other widget loads.
      ...permissionsForModule(ModuleKey.Leaderboard, ['read']),
      modulePermission(ModuleKey.CrmService, 'read'),
      modulePermission(ModuleKey.CrmService, 'write'),
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
      // Editing a lead's primary contact on the Lead Detail page (PAC-38) is a
      // `clients` write — a Contact is a CRM record, not a lead field. `write`
      // implies `read` in `resolvePermissionSet`, so this single grant is
      // enough. Note the scope clamp cannot come from the module: `Contact` has
      // no `producerId`, so `ContactAccessService` derives ownership from the
      // leads that reach the contact.
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
      // "Start Quote" on the Household page spans two modules — step 1 creates
      // the lead, step 2 writes the recap — and it is the CSR who runs it and
      // takes the resulting quote ticket. Without this the button is disabled
      // for exactly the role the flow was built around.
      //
      // A narrow widening, unlike the `clients:read` grant rejected under
      // PAC-32/33: `quote_recaps` has no entry in `nav-items.ts`, so it opens
      // `/quote-recaps/new` and this button and surfaces no new page.
      ...permissionsForModule(ModuleKey.QuoteRecaps),
    ],
  },
  {
    name: 'CRM',
    slug: 'crm',
    description: 'Client service — branch clients and tickets.',
    dataScope: DataScope.Branch,
    permissions: [
      modulePermission(ModuleKey.Dashboard, 'read'),
      modulePermission(ModuleKey.Clients, 'read'),
      modulePermission(ModuleKey.Clients, 'write'),
      modulePermission(ModuleKey.CrmService, 'read'),
      modulePermission(ModuleKey.CrmService, 'write'),
      modulePermission(ModuleKey.DealAudits, 'read'),
      modulePermission(ModuleKey.DealAudits, 'write'),
      modulePermission(ModuleKey.Onboardings, 'read'),
      modulePermission(ModuleKey.Onboardings, 'write'),
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
    ],
  },
];
