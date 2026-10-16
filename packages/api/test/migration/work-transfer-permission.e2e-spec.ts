import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { AgencyPermission } from '@sfa/shared';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AccessResolverService } from '../../src/permissions/access-resolver.service';
import { Permission } from '../../src/permissions/schemas/permission.schema';
import { RolePermission } from '../../src/permissions/schemas/role-permission.schema';
import { AgencyRole } from '../../src/roles/schemas/agency-role.schema';
import { User } from '../../src/users/schemas/user.schema';
import { authHeader, login } from '../helpers/auth.helper';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from '../helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from '../helpers/seed-test-data';

// The migration is plain CommonJS, as migrate-mongo requires — there is no ES
// module to import, so the rule is switched off for exactly this one line.
/* eslint-disable @typescript-eslint/no-require-imports */
const migration =
  require('../../migrations/20261002120000-work_transfer_for_agency_owners.js') as {
    up(db: unknown): Promise<void>;
    down(db: unknown): Promise<void>;
  };
/* eslint-enable @typescript-eslint/no-require-imports */

const KEY = AgencyPermission.WorkTransfer;

/**
 * PAC-136 — the migration that gives existing Agency Owner roles the new
 * permission. Run against a database seeded the way a real one is (catalog +
 * roles through the services), then checked through the Mongoose models, so a
 * wrong collection or field name in the migration shows up here rather than
 * as an owner who cannot see the feature after deploy (PAC-133 all over).
 */
describe('work_transfer_for_agency_owners migration (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let ctx: TestSeedContext;
  let rolePermissions: Model<RolePermission>;
  let permissions: Model<Permission>;
  let roles: Model<AgencyRole>;
  let users: Model<User>;
  let accessResolver: AccessResolverService;

  const db = () => connection.db!;
  const ownerGrants = () =>
    rolePermissions.countDocuments({
      roleId: new Types.ObjectId(ctx.ownerRoleId),
      permissionKey: KEY,
    });

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    connection = app.get<Connection>(getConnectionToken());
    rolePermissions = app.get<Model<RolePermission>>(
      getModelToken(RolePermission.name),
    );
    permissions = app.get<Model<Permission>>(getModelToken(Permission.name));
    roles = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
    users = app.get<Model<User>>(getModelToken(User.name));
    accessResolver = app.get(AccessResolverService);
    ctx = await seedTestData(app);
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  it('grants the permission to an owner role that lacks it, and nothing else', async () => {
    // A database seeded before the permission existed: the template gave it
    // to this owner role, so take it away again to stage that state.
    await rolePermissions.deleteMany({ permissionKey: KEY });
    await permissions.deleteOne({ key: KEY });
    expect(await ownerGrants()).toBe(0);

    await migration.up(db());

    expect(await ownerGrants()).toBe(1);
    const grant = await rolePermissions
      .findOne({
        roleId: new Types.ObjectId(ctx.ownerRoleId),
        permissionKey: KEY,
      })
      .lean();
    expect(grant?.source).toBe('template');
    expect(grant?.agencyId?.toString()).toBe(ctx.agencyId);
    // The catalog row is written too, with the values the shared catalog
    // derives — `seedPermissions` will re-assert exactly these later.
    const row = await permissions.findOne({ key: KEY }).lean();
    expect(row).toMatchObject({
      kind: 'agency',
      resource: 'agency:work_transfer',
      action: 'write',
      group: 'Agency administration',
      assignableToUser: false,
      isDeprecated: false,
    });
    expect(grant?.permissionId?.toString()).toBe(row!._id.toString());

    // Only owner roles — one grant per agency's owner role (the seed makes two
    // agencies); the producer, CSR and read-only roles are untouched.
    const ownerRoles = await roles.countDocuments({ slug: 'agency_owner' });
    expect(ownerRoles).toBeGreaterThan(1);
    expect(await rolePermissions.countDocuments({ permissionKey: KEY })).toBe(
      ownerRoles,
    );
  });

  it('is idempotent', async () => {
    await migration.up(db());
    await migration.up(db());
    expect(await ownerGrants()).toBe(1);
    expect(await permissions.countDocuments({ key: KEY })).toBe(1);
  });

  it('makes the feature usable by the owner after the cache is dropped', async () => {
    await accessResolver.invalidateAgency(ctx.agencyId);
    const token = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;
    const producer = await users.findOne({ email: ctx.producerEmail }).lean();
    await request(app.getHttpServer())
      .get(`/api/v1/users/${producer!._id.toString()}/work-transfer/candidates`)
      .set(authHeader(token))
      .expect(200);
  });

  it('down removes every grant and deprecates the catalog row; up restores both', async () => {
    await migration.down(db());
    expect(await rolePermissions.countDocuments({ permissionKey: KEY })).toBe(
      0,
    );
    expect((await permissions.findOne({ key: KEY }).lean())?.isDeprecated).toBe(
      true,
    );

    await migration.up(db());
    expect(await ownerGrants()).toBe(1);
    expect((await permissions.findOne({ key: KEY }).lean())?.isDeprecated).toBe(
      false,
    );
  });

  it('does nothing on a database with no permission catalog yet', async () => {
    await permissions.deleteMany({});
    await rolePermissions.deleteMany({ permissionKey: KEY });

    await migration.up(db());

    expect(await permissions.countDocuments({})).toBe(0);
    expect(await rolePermissions.countDocuments({ permissionKey: KEY })).toBe(
      0,
    );
  });
});
