import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { ALL_MODULE_KEYS } from '@sfa/shared';
import { AppModule } from '../app.module';
import { AuditTemplate } from '../audit-templates/schemas/audit-template.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency } from '../platform/schemas/agency.schema';
import { User } from '../users/schemas/user.schema';
import { seedAuditTemplates } from './audit-templates.seed';

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
  const permissionsService = app.get(PermissionsService);

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
  // Add platform-wide catalog seeding here as those collections come online.
  // Anything seeded here must be part of a shipped feature and required for the
  // app to function — never demo/tenant data (that belongs in the demo seed).

  // ---------------------------------------------------------------------------
  // 3. Empty tenant scaffold — migration target (no demo users, no CRM data)
  // ---------------------------------------------------------------------------
  const modules = Object.fromEntries(
    ALL_MODULE_KEYS.map((key) => [key, { enabled: true }]),
  );

  let agency = await agencyModel.findOne({ slug: 'smith-family-agency' });
  if (!agency) {
    agency = await agencyModel.create({
      name: 'Smith Family Agency',
      slug: 'smith-family-agency',
      status: 'active',
      modules,
    });
    console.log('Created agency: Smith Family Agency');
  } else {
    console.log('Agency already exists, skipping create');
  }

  await permissionsService.seedDefaultRoles(agency._id);
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

  console.log('\nCore seed complete.');
  console.log(`Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
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
