import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { ALL_MODULE_KEYS } from '@sfa/shared';
import { AppModule } from '../app.module';
import { AuditTemplate } from '../audit-templates/schemas/audit-template.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { Carrier } from '../carriers/schemas/carrier.schema';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { Permission } from '../permissions/schemas/permission.schema';
import { Agency } from '../platform/schemas/agency.schema';
import { AgencyRole } from '../roles/schemas/agency-role.schema';
import { User } from '../users/schemas/user.schema';
import { seedAuditTemplates } from './audit-templates.seed';
import { seedCarriers } from './carriers.seed';
import { seedPermissions } from './permissions.seed';

/**
 * Core seed — platform-required data only.
 *
 * This seed provisions the minimum needed for the app to *function* and is safe
 * to run in every environment (including production) and on API startup:
 *   1. The platform super admin (so the platform can be logged into and agencies
 *      provisioned).
 *   2. Global catalog / feature data (plans, feature definitions, constants) —
 *      see the marked section below as these collections come online.
 *   3. A single empty tenant scaffold (Smith Family Agency + Main branch +
 *      default roles) that the SmartSuite -> Mongo migration imports into.
 *
 * It intentionally does NOT create demo users or any CRM data. For a fully
 * populated agency to build/test against, use the demo seed instead
 * (`npm run seed:demo:dev`, see `src/seed/demo`).
 */
async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const agencyModel = app.get<Model<Agency>>(getModelToken(Agency.name));
  const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const auditTemplateModel = app.get<Model<AuditTemplate>>(
    getModelToken(AuditTemplate.name),
  );
  const carrierModel = app.get<Model<Carrier>>(getModelToken(Carrier.name));
  const roleModel = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
  const permissionModel = app.get<Model<Permission>>(
    getModelToken(Permission.name),
  );
  const roleAssignments = app.get(RoleAssignmentsService);

  // ---------------------------------------------------------------------------
  // 1. Platform super admin (required for the app to function)
  // ---------------------------------------------------------------------------
  const superAdminEmail =
    process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@sfa.local';
  const superAdminPassword =
    process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const existingSuperAdmin = await userModel.findOne({
    email: superAdminEmail,
  });
  if (!existingSuperAdmin) {
    await userModel.create({
      email: superAdminEmail,
      passwordHash: await bcrypt.hash(superAdminPassword, 12),
      isPlatformAdmin: true,
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
    });
    console.log(`Created super admin: ${superAdminEmail}`);
  } else {
    await userModel.updateOne(
      { _id: existingSuperAdmin._id },
      { $set: { isPlatformAdmin: true }, $unset: { roles: 1 } },
    );
    console.log('Super admin updated');
  }

  // ---------------------------------------------------------------------------
  // 2. Global catalog / feature data (plans, feature definitions, constants)
  // ---------------------------------------------------------------------------
  // Anything seeded here must be part of a shipped feature and required for the
  // app to function — never demo/tenant data (that belongs in the demo seed).

  // Carrier catalog (PAC-56 #19). Platform-required, not demo data: it is the
  // only source for the Sold wizard's carrier select, so an empty collection
  // forces every sale through the "Other" escape. Rows carry `agencyId: null`,
  // which is what makes them visible to every tenant.
  const carriers = await seedCarriers(carrierModel);
  console.log(
    `Carriers seeded (${carriers.created} created, ${carriers.refreshed} already present)`,
  );

  // The permission vocabulary as rows, for `rolePermissions` and
  // `userPermissions` to reference. Must precede role seeding:
  // `setRolePermissions` resolves each key to a catalog id and refuses one it
  // cannot find, so a missing catalog fails loudly instead of producing roles
  // that grant nothing.
  const permissions = await seedPermissions(permissionModel);
  console.log(
    `Permissions seeded (${permissions.created} created, ${permissions.updated} updated, ${permissions.deprecated} deprecated)`,
  );

  // ---------------------------------------------------------------------------
  // 3. Empty tenant scaffold — migration target (no demo users, no CRM data)
  // ---------------------------------------------------------------------------
  const modules = Object.fromEntries(
    ALL_MODULE_KEYS.map((key) => [key, { enabled: true }]),
  );

  // The mailer identity fields (PAC-73). `ticker` is how the BigQuery backfill
  // attributes a row to this tenant; `allstateAgencyId` is what an uploaded RTP
  // file's `agencyid` column is cross-checked against. Both are reconciled on
  // an existing agency rather than only set on create, because the scaffold
  // predates them and a database seeded before PAC-73 would otherwise import
  // nothing and warn on every upload.
  const mailerIdentity = { ticker: 'SFA', allstateAgencyId: 'A0B9049' };

  let agency = await agencyModel.findOne({ slug: 'smith-family-agency' });
  if (!agency) {
    agency = await agencyModel.create({
      name: 'Smith Family Agency',
      slug: 'smith-family-agency',
      status: 'active',
      modules,
      ...mailerIdentity,
    });
    console.log('Created agency: Smith Family Agency');
  } else {
    await agencyModel.updateOne({ _id: agency._id }, { $set: mailerIdentity });
    console.log('Agency already exists, mailer identity reconciled');
  }

  await roleAssignments.seedDefaultRoles(agency._id);
  console.log('Default agency roles seeded');

  let branch = await branchModel.findOne({
    agencyId: agency._id,
    slug: 'main',
  });
  if (!branch) {
    branch = await branchModel.create({
      agencyId: agency._id,
      name: 'Main',
      slug: 'main',
      isDefault: true,
    });
    console.log('Created branch: Main');
  } else {
    console.log('Branch already exists, skipping create');
  }

  // Post-sale audit checklist (PAC-40). Platform-required, not demo data:
  // `AuditGenerationService` resolves computed titles against this collection
  // by exact name, so an agency without it books sold deals that generate no
  // service hand-off at all — silently, because generation is best-effort.
  const templates = await seedAuditTemplates(
    auditTemplateModel,
    agency._id.toString(),
    branch._id.toString(),
  );
  console.log(
    `Audit templates seeded (${templates.created} created, ${templates.refreshed} already present)`,
  );

  // ---------------------------------------------------------------------------
  // 4. Agency owner — the one login that can administer the tenant
  // ---------------------------------------------------------------------------
  //
  // Without this a migrated agency is unreachable. The SmartSuite migration
  // gives every user it creates `passwordHash: randomBytes(24).toString('hex')`
  // and `roleIds: []` — a hash bcrypt can never match, and no role, so login
  // fails and would resolve to zero permissions even if it succeeded. Nobody
  // can bootstrap out of that from inside the app either: the platform super
  // admin resolves to ALL_PLATFORM_PERMISSIONS only, holds no `agency:*`, and
  // `PermissionsGuard` has no platform-admin bypass, so `POST /users/invite`
  // 403s. There is no password-reset endpoint.
  //
  // Gated on the password being set, so production never silently gains an
  // account with a default password. Everyone else is then onboarded through
  // the normal invite flow.
  const ownerEmail = process.env.SEED_AGENCY_OWNER_EMAIL?.toLowerCase().trim();
  const ownerPassword = process.env.SEED_AGENCY_OWNER_PASSWORD;

  if (!ownerEmail || !ownerPassword) {
    console.log(
      'Agency owner skipped (set SEED_AGENCY_OWNER_EMAIL + SEED_AGENCY_OWNER_PASSWORD to create one)',
    );
  } else {
    const ownerRole = await roleModel
      .findOne({ agencyId: agency._id, slug: 'agency_owner' })
      .select('_id')
      .lean();
    if (!ownerRole) {
      throw new Error(
        'agency_owner role missing — seedDefaultRoles should have created it',
      );
    }

    await userModel.updateOne(
      { email: ownerEmail },
      {
        $set: {
          agencyId: agency._id,
          branchId: branch._id,
          isActive: true,
          isPlatformAdmin: false,
          deactivatedAt: null,
          deactivatedByUserId: null,
          // In `$set`, not `$setOnInsert`, on purpose: re-running the seed is
          // the supported way to recover a lost owner password. `$setOnInsert`
          // would silently no-op on the row that actually needs it.
          passwordHash: await bcrypt.hash(ownerPassword, 12),
          // A sentinel rather than an absent field or an explicit null. The
          // `legacySmartSuiteId` index is `unique + sparse`: absent is skipped,
          // but an explicit null IS indexed and would collide with any other
          // null. This also marks the row as seed-created, not migrated.
          legacySmartSuiteId: 'seed:agency-owner',
        },
        $setOnInsert: { firstName: 'Agency', lastName: 'Owner' },
      },
      { upsert: true },
    );

    // Through the join, never a field on the user: `RoleAssignmentsService` is
    // the only writer of `userRoles`, and it is also what invalidates the
    // resolved-permission cache.
    const owner = await userModel
      .findOne({ email: ownerEmail })
      .select('_id')
      .lean();
    await roleAssignments.setUserRoles(
      { userId: owner!._id.toString(), isPlatformAdmin: true },
      agency._id,
      owner!._id,
      [ownerRole._id],
    );
    console.log(`Agency owner ready: ${ownerEmail}`);
  }

  console.log('\nCore seed complete.');
  console.log(`Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
  if (ownerEmail && ownerPassword) {
    console.log(`Agency Owner: ${ownerEmail} / ${ownerPassword}`);
  }
  console.log(
    'Tenant scaffold ready: Smith Family Agency / Main branch (empty).',
  );
  console.log(
    'For a populated agency to test against, run: npm run seed:demo:dev',
  );

  await app.close();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
