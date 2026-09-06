import { Model, Types } from 'mongoose';
import { ALL_MODULE_KEYS } from '@sfa/shared';

import { AuditTemplate } from '../audit-templates/schemas/audit-template.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { Agency } from '../platform/schemas/agency.schema';
import { seedAuditTemplates } from './audit-templates.seed';

/**
 * Provisioning a tenant — everything an agency needs before it can hold data.
 *
 * This deliberately does **not** live in the core seed. The core seed is
 * platform-required data only (super admin, carrier catalog, permission
 * vocabulary) and is safe to run in every environment; an agency is tenant
 * data, and which agency exists is a decision belonging to whoever is creating
 * one. Today that is the SmartSuite migration (the real agency) and the demo
 * seed (a throwaway one).
 *
 * It provisions **no users**. The migrated agency's only users are the ones
 * SmartSuite supplied; the demo seed creates its own team explicitly. Nothing
 * here invents an account — the migration instead promotes one *migrated* user
 * to Agency Owner (`MigrationService.assignAgencyOwner`), which is what gives
 * the tenant an administrator without adding a person the legacy book never had.
 *
 * ## Not used by the Super Admin panel, on purpose (PAC-69)
 * `AgencyProvisioningService` runs the same sequence for an operator onboarding
 * a client agency, and deliberately does **not** call this function. The reason
 * is the find-or-create above: it exists so the migration can be resumed with
 * `--from 2`, but an operator who types a slug that already exists has made a
 * mistake that must be reported as a `409` — silently adopting the existing
 * tenant and attaching a brand-new owner account to it is the one outcome
 * neither caller wants. The two share what matters (`seedDefaultRoles`,
 * `seedAuditTemplates`) and differ on that single rule; keep them that way
 * rather than adding a flag here.
 */

export interface ProvisionTenantModels {
  agencyModel: Model<Agency>;
  branchModel: Model<Branch>;
  auditTemplateModel: Model<AuditTemplate>;
  roleAssignments: RoleAssignmentsService;
}

export interface ProvisionTenantOptions {
  slug: string;
  name: string;
  branchSlug: string;
  branchName: string;
  /**
   * Mailer identity (PAC-73). `ticker` is how the BigQuery backfill attributes
   * a row to this tenant and `allstateAgencyId` is what an uploaded RTP file's
   * `agencyid` column is checked against — so an agency provisioned without
   * them imports no mailers and warns on every upload.
   */
  ticker?: string;
  allstateAgencyId?: string;
}

export interface ProvisionedTenant {
  agencyId: Types.ObjectId;
  branchId: Types.ObjectId;
  agencyCreated: boolean;
  branchCreated: boolean;
  templates: { created: number; refreshed: number };
}

/**
 * Find-or-create an agency, its default branch, its default roles and its
 * post-sale audit checklist. Idempotent: re-running reconciles rather than
 * duplicates, which is what lets the migration own provisioning and still be
 * safe to resume with `--from 2`.
 */
export async function provisionTenant(
  models: ProvisionTenantModels,
  options: ProvisionTenantOptions,
): Promise<ProvisionedTenant> {
  const { agencyModel, branchModel, auditTemplateModel, roleAssignments } =
    models;

  const modules = Object.fromEntries(
    ALL_MODULE_KEYS.map((key) => [key, { enabled: true }]),
  );

  /*
   * The mailer identity is reconciled on an existing agency rather than only
   * set on create: agencies provisioned before PAC-73 predate both fields, and
   * would otherwise import nothing forever.
   */
  const mailerIdentity: Record<string, string> = {};
  if (options.ticker) mailerIdentity.ticker = options.ticker;
  if (options.allstateAgencyId) {
    mailerIdentity.allstateAgencyId = options.allstateAgencyId;
  }

  let agency = await agencyModel.findOne({ slug: options.slug });
  const agencyCreated = !agency;
  if (!agency) {
    agency = await agencyModel.create({
      name: options.name,
      slug: options.slug,
      status: 'active',
      modules,
      ...mailerIdentity,
    });
  } else if (Object.keys(mailerIdentity).length) {
    await agencyModel.updateOne({ _id: agency._id }, { $set: mailerIdentity });
  }

  // Must follow the permission catalog from the core seed: `setRolePermissions`
  // resolves each key to a catalog id and refuses one it cannot find.
  await roleAssignments.seedDefaultRoles(agency._id);

  let branch = await branchModel.findOne({
    agencyId: agency._id,
    slug: options.branchSlug,
  });
  const branchCreated = !branch;
  if (!branch) {
    branch = await branchModel.create({
      agencyId: agency._id,
      name: options.branchName,
      slug: options.branchSlug,
      isDefault: true,
    });
  }

  /*
   * Platform-defined content, tenant-scoped storage. `AuditGenerationService`
   * resolves the titles it computes against this collection **by exact name**,
   * so a tenant with an empty catalog books sold deals that generate no service
   * hand-off at all — silently, because generation is best-effort.
   */
  const templates = await seedAuditTemplates(
    auditTemplateModel,
    agency._id.toString(),
    branch._id.toString(),
  );

  return {
    agencyId: agency._id,
    branchId: branch._id,
    agencyCreated,
    branchCreated,
    templates,
  };
}
