import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { ALL_MODULE_KEYS, DataScope } from '@sfa/shared';
import { Branch } from '../../src/branches/schemas/branch.schema';
import { Contact } from '../../src/contacts/schemas/contact.schema';
import { Household } from '../../src/households/schemas/household.schema';
import { PermissionsService } from '../../src/permissions/permissions.service';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { Policy } from '../../src/policies/schemas/policy.schema';
import { AgencyRole } from '../../src/roles/schemas/agency-role.schema';
import { User } from '../../src/users/schemas/user.schema';

export const TEST_PASSWORD = 'TestPass123!';

export interface TestSeedContext {
  agencyId: string;
  branchId: string;
  ownerRoleId: string;
  producerRoleId: string;
  csrRoleId: string;
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
  csrEmail: string;
  readOnlyEmail: string;
  /** Client records in the main test branch. */
  householdId: string;
  policyId: string;
  /** A second in-scope household + policy, for household-scoped filtering. */
  secondHouseholdId: string;
  secondPolicyId: string;
  /** In a second branch of the same agency — invisible to branch-scoped users. */
  otherBranchHouseholdId: string;
  /** In a different agency entirely. */
  otherAgencyHouseholdId: string;
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
  const csrRole = await roleModel.findOne({
    agencyId: agency._id,
    slug: 'csr',
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
  const csrEmail = 'test-csr@sfa.local';
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
    email: csrEmail,
    passwordHash,
    roleIds: csrRole ? [csrRole._id] : [],
    firstName: 'Test',
    lastName: 'Csr',
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

  // ── Client records ──────────────────────────────────────────────────────
  // NOTE: these collections extend `TenantRecord`, whose agencyId/branchId are
  // plain STRINGS (unlike ServiceTicket, which stores them as ObjectIds).
  const householdModel = app.get<Model<Household>>(
    getModelToken(Household.name),
  );
  const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
  const contactModel = app.get<Model<Contact>>(getModelToken(Contact.name));

  const tenant = {
    agencyId: agency._id.toString(),
    branchId: branch._id.toString(),
  };

  // Every record needs a distinct `legacySmartSuiteId`: the schema's
  // {agencyId, legacySmartSuiteId} index is unique+sparse, but a COMPOUND
  // sparse index still indexes a doc when only one field is present — so two
  // records in one agency with a null legacySmartSuiteId collide.
  const household = await householdModel.create({
    ...tenant,
    legacySmartSuiteId: 'test:hh:main',
    name: 'Test Household',
    status: 'Active',
    primaryContactName: 'Test Client',
    primaryEmails: ['client@test.local'],
    primaryPhones: ['(555) 010-0100'],
    propertyAddress: { line1: '1 Test St', city: 'Austin', state: 'TX' },
    totalActivePolicies: 1,
  });

  await contactModel.create({
    ...tenant,
    legacySmartSuiteId: 'test:ct:main',
    firstName: 'Test',
    lastName: 'Client',
    emails: ['client@test.local'],
    roleInHousehold: 'Named Insured',
    isPrimary: true,
    householdId: household._id,
  });

  const policy = await policyModel.create({
    ...tenant,
    legacySmartSuiteId: 'test:pol:main',
    policyNumber: 'TEST-000-1',
    policyType: 'Auto',
    carrier: 'Test Carrier',
    active: true,
    policyStatus: 'Active',
    premium: 1200,
    items: 1,
    householdId: household._id,
  });

  // A second household in the SAME branch, with its own policy. Both are fully
  // visible to the same users — they exist so the household-scoped policy
  // search has something in scope that it must still exclude.
  const secondHousehold = await householdModel.create({
    ...tenant,
    legacySmartSuiteId: 'test:hh:second',
    name: 'Second Test Household',
    status: 'Active',
    primaryContactName: 'Second Client',
    totalActivePolicies: 1,
  });

  const secondPolicy = await policyModel.create({
    ...tenant,
    legacySmartSuiteId: 'test:pol:second',
    policyNumber: 'TEST-000-2',
    policyType: 'Auto',
    carrier: 'Test Carrier',
    active: true,
    policyStatus: 'Active',
    premium: 900,
    items: 1,
    householdId: secondHousehold._id,
  });

  // A second branch, so branch-scoped users have something they must NOT see.
  const otherBranch = await branchModel.create({
    agencyId: agency._id,
    name: 'Other Branch',
    slug: 'other-branch',
    isDefault: false,
  });
  const otherBranchHousehold = await householdModel.create({
    agencyId: agency._id.toString(),
    branchId: otherBranch._id.toString(),
    legacySmartSuiteId: 'test:hh:other-branch',
    name: 'Other Branch Household',
    status: 'Active',
  });

  // A record belonging to a different agency entirely.
  const otherAgency = await agencyModel.create({
    name: 'Other Agency',
    slug: 'other-agency',
    status: 'active',
    modules,
  });
  const otherAgencyHousehold = await householdModel.create({
    agencyId: otherAgency._id.toString(),
    branchId: otherBranch._id.toString(),
    legacySmartSuiteId: 'test:hh:other-agency',
    name: 'Other Agency Household',
    status: 'Active',
  });

  return {
    agencyId: agency._id.toString(),
    branchId: branch._id.toString(),
    householdId: household._id.toString(),
    policyId: policy._id.toString(),
    secondHouseholdId: secondHousehold._id.toString(),
    secondPolicyId: secondPolicy._id.toString(),
    otherBranchHouseholdId: otherBranchHousehold._id.toString(),
    otherAgencyHouseholdId: otherAgencyHousehold._id.toString(),
    ownerRoleId: ownerRole!._id.toString(),
    producerRoleId: producerRole!._id.toString(),
    csrRoleId: csrRole!._id.toString(),
    readOnlyRoleId: readOnlyRole._id.toString(),
    editableRoleId: editableRole._id.toString(),
    superAdminEmail,
    ownerEmail,
    producerEmail,
    csrEmail,
    readOnlyEmail,
  };
}
