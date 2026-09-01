import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { AppModule } from '../app.module';
import { Carrier } from '../carriers/schemas/carrier.schema';
import { Permission } from '../permissions/schemas/permission.schema';
import { User } from '../users/schemas/user.schema';
import { seedCarriers } from './carriers.seed';
import { seedPermissions } from './permissions.seed';

/**
 * Core seed — platform-required data only.
 *
 * This seed provisions the minimum needed for the app to *function* and is safe
 * to run in every environment (including production) and on API startup:
 *   1. The platform super admin (so the platform can be logged into and agencies
 *      provisioned).
 *   2. Global catalog / feature data — the carrier catalog and the permission
 *      vocabulary. Both are tenant-agnostic rows.
 *
 * It creates **no agency**. An agency is tenant data, and provisioning one is
 * the job of whoever is creating that tenant:
 *   - the real agency comes from the SmartSuite migration
 *     (`npm run migrate:dev`, which owns agency + branch + roles + audit
 *     templates, creates no users but the migrated ones, and promotes one of
 *     those to Agency Owner so the tenant has an administrator);
 *   - a throwaway populated agency comes from the demo seed
 *     (`npm run seed:demo:dev`, see `src/seed/demo`).
 *
 * Anything added here must be required for the app to function at all. If it
 * belongs to an agency, it belongs in one of those two instead.
 */
async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const carrierModel = app.get<Model<Carrier>>(getModelToken(Carrier.name));
  const permissionModel = app.get<Model<Permission>>(
    getModelToken(Permission.name),
  );

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

  console.log('\nCore seed complete.');
  console.log(`Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log('No agency was created — this seed is platform data only.');
  console.log(
    'For the real agency + its data, run: ./scripts/migration/run-migration.sh',
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
