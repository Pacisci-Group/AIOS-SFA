import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { ALL_MODULE_KEYS, DataScope } from '@sfa/shared';
import { Branch } from '../../src/branches/schemas/branch.schema';
import { PermissionsService } from '../../src/permissions/permissions.service';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { AgencyRole } from '../../src/roles/schemas/agency-role.schema';
import { User } from '../../src/users/schemas/user.schema';

export const TEST_PASSWORD = 'TestPass123!';

export interface TestSeedContext {
  agencyId: string;
  branchId: string;
  ownerRoleId: string;
  producerRoleId: string;
  readOnlyRoleId: string;
  /**
   * A disposable role for tests that mutate a role's page levels. Kept separate
   * from `readOnlyRoleId` so that role-editing tests don't change the effective
   * permissions of the read-only user (permissions are now resolved live from
   * the store, so mutating a shared role would leak into other suites).
   */
  editableRoleId: string;
  superAdminEmail: string;
  ownerEmail: string;
  producerEmail: string;
  readOnlyEmail: string;
}

export async function seedTestData(
  app: INestApplication,
): Promise<TestSeedContext> {
  const agencyModel = app.get<Model<Agency>>(getModelToken(Agency.name));
  const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const roleModel = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
  const permissionsService = app.get(PermissionsService);

  const modules = Object.fromEntries(
    ALL_MODULE_KEYS.map((key) => [key, { enabled: true }]),
  );

  const agency = await agencyModel.create({
    name: 'Test Agency',
    slug: 'test-agency',
    status: 'active',
    modules,
  });

  await permissionsService.seedDefaultRoles(agency._id);

  const branch = await branchModel.create({
    agencyId: agency._id,
    name: 'Test Branch',
    slug: 'test-branch',
    isDefault: true,
  });

  const ownerRole = await roleModel.findOne({
    agencyId: agency._id,
    slug: 'agency_owner',
  });
  const producerRole = await roleModel.findOne({
    agencyId: agency._id,
    slug: 'producer',
  });

  // A role with read-only access to every page (no write anywhere). Used to
  // assert that mutating endpoints require `{module}:write` on every page.
  const readOnlyRole = await roleModel.create({
    agencyId: agency._id,
    name: 'Read Only',
    slug: 'read_only',
    permissions: ALL_MODULE_KEYS.map((key) => `${key}:read`),
    dataScope: DataScope.Agency,
    isSystemTemplate: false,
  });

  // A throwaway role for role-editing tests to mutate freely, so the shared
  // read-only role above stays pristine for the page-level guardrail suite.
  const editableRole = await roleModel.create({
    agencyId: agency._id,
    name: 'Editable Test Role',
    slug: 'editable_test',
    permissions: ALL_MODULE_KEYS.map((key) => `${key}:read`),
    dataScope: DataScope.Agency,
    isSystemTemplate: false,
  });

  const superAdminEmail = 'test-super-admin@sfa.local';
  const ownerEmail = 'test-owner@sfa.local';
  const producerEmail = 'test-producer@sfa.local';
  const readOnlyEmail = 'test-read-only@sfa.local';
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  await userModel.create({
    email: superAdminEmail,
    passwordHash,
    isPlatformAdmin: true,
    firstName: 'Test',
    lastName: 'SuperAdmin',
    isActive: true,
  });

  await userModel.create({
    agencyId: agency._id,
    email: ownerEmail,
    passwordHash,
    roleIds: ownerRole ? [ownerRole._id] : [],
    firstName: 'Test',
    lastName: 'Owner',
    isActive: true,
  });

  await userModel.create({
    agencyId: agency._id,
    branchId: branch._id,
    email: producerEmail,
    passwordHash,
    roleIds: producerRole ? [producerRole._id] : [],
    firstName: 'Test',
    lastName: 'Producer',
    isActive: true,
  });

  await userModel.create({
    agencyId: agency._id,
    branchId: branch._id,
    email: readOnlyEmail,
    passwordHash,
    roleIds: [readOnlyRole._id],
    firstName: 'Test',
    lastName: 'ReadOnly',
    isActive: true,
  });

  return {
    agencyId: agency._id.toString(),
    branchId: branch._id.toString(),
    ownerRoleId: ownerRole!._id.toString(),
    producerRoleId: producerRole!._id.toString(),
    readOnlyRoleId: readOnlyRole._id.toString(),
    editableRoleId: editableRole._id.toString(),
    superAdminEmail,
    ownerEmail,
    producerEmail,
    readOnlyEmail,
  };
}
