import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { ALL_MODULE_KEYS } from '@sfa/shared';
import { AppModule } from '../app.module';
import { Branch } from '../branches/schemas/branch.schema';
import { PermissionsService } from '../permissions/permissions.service';
import { Agency } from '../platform/schemas/agency.schema';
import { AgencyRole } from '../roles/schemas/agency-role.schema';
import { User } from '../users/schemas/user.schema';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const agencyModel = app.get<Model<Agency>>(getModelToken(Agency.name));
  const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const roleModel = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
  const permissionsService = app.get(PermissionsService);

  const superAdminEmail =
    process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@sfa.local';
  const superAdminPassword =
    process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

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

  const ownerRole = await roleModel.findOne({
    agencyId: agency._id,
    slug: 'agency_owner',
  });

  const existingSuperAdmin = await userModel.findOne({ email: superAdminEmail });
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

  const ownerEmail =
    process.env.SEED_AGENCY_OWNER_EMAIL ?? 'owner@smithfamily.local';
  const ownerPassword =
    process.env.SEED_AGENCY_OWNER_PASSWORD ?? 'ChangeMe123!';

  const existingOwner = await userModel.findOne({ email: ownerEmail });
  if (!existingOwner) {
    await userModel.create({
      agencyId: agency._id,
      email: ownerEmail,
      passwordHash: await bcrypt.hash(ownerPassword, 12),
      roleIds: ownerRole ? [ownerRole._id] : [],
      firstName: 'Agency',
      lastName: 'Owner',
      isActive: true,
    });
    console.log(`Created agency owner: ${ownerEmail}`);
  } else if (ownerRole) {
    await userModel.updateOne(
      { _id: existingOwner._id },
      {
        $set: { roleIds: [ownerRole._id] },
        $unset: { roles: 1 },
      },
    );
    console.log('Agency owner updated with agency_owner role');
  }

  console.log('\nSeed complete.');
  console.log(`Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`Agency Owner: ${ownerEmail} / ${ownerPassword}`);

  await app.close();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
