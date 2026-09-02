import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type { PlatformUserListResponse, PlatformUserRow } from '@sfa/shared';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * The cross-agency user directory behind Find / Impersonate User (PAC-70).
 *
 * The seed gives two tenants: the main test agency (owner, producer, CSR,
 * read-only) and Other Agency with one user, `other-producer@sfa.local`, who
 * holds both `producer` and `csr` — the row every multi-select assertion
 * turns on.
 */
describe('Platform user directory (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let superAdminToken: string;
  let ownerToken: string;

  const api = () => request(app.getHttpServer());
  const list = async (query: Record<string, string | string[]> = {}) => {
    const res = await api()
      .get('/api/v1/platform/users')
      .query(query)
      .set(authHeader(superAdminToken))
      .expect(200);
    return res.body as PlatformUserListResponse;
  };
  const emails = (body: PlatformUserListResponse) =>
    body.items.map((row) => row.email);

  beforeAll(async () => {
    app = await createTestApp();
    ctx = await seedTestData(app);
    superAdminToken = (await login(app, ctx.superAdminEmail, TEST_PASSWORD))
      .accessToken;
    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  it('lists tenant users across every agency, never the platform admin', async () => {
    const body = await list();
    const found = emails(body);
    expect(found).toContain(ctx.producerEmail);
    expect(found).toContain(ctx.otherAgencyUserEmail);
    expect(found).not.toContain(ctx.superAdminEmail);

    const other = body.items.find(
      (row) => row.email === ctx.otherAgencyUserEmail,
    )!;
    expect(other.agency).toMatchObject({
      id: ctx.otherAgencyId,
      slug: 'other-agency',
    });
    expect(other.branch?.name).toBe('Other Agency Branch');
    expect(other.roles.map((role) => role.slug).sort()).toEqual([
      'csr',
      'producer',
    ]);
    expect(other.isActive).toBe(true);
  });

  it('rows carry display fields only', async () => {
    const row = (await list()).items[0] as PlatformUserRow &
      Record<string, unknown>;
    expect(row.passwordHash).toBeUndefined();
    expect(row.inviteToken).toBeUndefined();
    expect(row.passwordResetToken).toBeUndefined();
    expect(row.agencyId).toBeUndefined();
    expect(row.legacySmartSuiteId).toBeUndefined();
  });

  it('searches by last name across agencies', async () => {
    // Both producers are surnamed "Producer", one in each tenant.
    const found = emails(await list({ q: 'producer' }));
    expect(found).toContain(ctx.producerEmail);
    expect(found).toContain(ctx.otherAgencyUserEmail);
    expect(found).not.toContain(ctx.ownerEmail);
  });

  it('searches by full name and by partial email', async () => {
    expect(emails(await list({ q: 'Other Producer' }))).toEqual([
      ctx.otherAgencyUserEmail,
    ]);
    expect(emails(await list({ q: 'test-read-only@' }))).toEqual([
      ctx.readOnlyEmail,
    ]);
  });

  it('searches by agency name', async () => {
    const body = await list({ q: 'Other Agency' });
    expect(body.total).toBeGreaterThan(0);
    for (const row of body.items) {
      expect(row.agency?.slug).toBe('other-agency');
    }
  });

  it('searches by role name', async () => {
    const roles = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
    const csr = await roles.findOne({ slug: 'csr' }).lean();
    const found = emails(await list({ q: csr!.name }));
    // The main agency's CSR and the other agency's dual-role user both hold it.
    expect(found).toContain(ctx.csrEmail);
    expect(found).toContain(ctx.otherAgencyUserEmail);
    expect(found).not.toContain(ctx.producerEmail);
  });

  it('narrows to the selected agencies', async () => {
    const body = await list({ agencyIds: ctx.otherAgencyId });
    expect(body.total).toBe(1);
    expect(body.items[0].email).toBe(ctx.otherAgencyUserEmail);

    // Multi-select: both agencies is everyone again.
    const both = await list({
      agencyIds: `${ctx.agencyId},${ctx.otherAgencyId}`,
    });
    expect(both.total).toBe((await list()).total);
  });

  it('ORs the selected role slugs, and lists a dual-role user once', async () => {
    const body = await list({ roleSlugs: ['producer', 'csr'] });
    const found = emails(body);
    expect(found).toContain(ctx.producerEmail);
    expect(found).toContain(ctx.csrEmail);
    expect(found).toContain(ctx.otherAgencyUserEmail);
    expect(found).not.toContain(ctx.ownerEmail);
    expect(found).not.toContain(ctx.readOnlyEmail);
    expect(
      found.filter((email) => email === ctx.otherAgencyUserEmail),
    ).toHaveLength(1);
  });

  it('combines search, agency and role filters', async () => {
    const body = await list({
      q: 'producer',
      agencyIds: ctx.agencyId,
      roleSlugs: 'csr',
    });
    // Surname matches two producers, the agency filter drops the other
    // tenant's, and the role filter drops the main producer (not a CSR).
    expect(body.total).toBe(0);

    const hit = await list({
      q: 'producer',
      agencyIds: ctx.otherAgencyId,
      roleSlugs: 'csr',
    });
    expect(emails(hit)).toEqual([ctx.otherAgencyUserEmail]);
  });

  it('treats a filter that resolves to nothing as an empty result, not no filter', async () => {
    const body = await list({ roleSlugs: 'no_such_role' });
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
    expect(body.totalPages).toBe(1);
  });

  it('returns nothing for a query that matches nothing', async () => {
    const body = await list({ q: 'zzz-nobody-has-this' });
    expect(body.total).toBe(0);
    expect(body.items).toEqual([]);
  });

  it('paginates deterministically', async () => {
    const all = await list({ pageSize: '100' });
    const first = await list({ pageSize: '2', page: '1' });
    const second = await list({ pageSize: '2', page: '2' });

    expect(first.items).toHaveLength(2);
    expect(first.totalPages).toBe(Math.ceil(all.total / 2));
    const overlap = emails(first).filter((email) =>
      emails(second).includes(email),
    );
    expect(overlap).toEqual([]);
    expect([...emails(first), ...emails(second)]).toEqual(
      emails(all).slice(0, 4),
    );
  });

  it('rejects a malformed agency id with 400, not 500', async () => {
    await api()
      .get('/api/v1/platform/users')
      .query({ agencyIds: 'not-an-id' })
      .set(authHeader(superAdminToken))
      .expect(400);
  });

  it('offers one Role option per distinct slug', async () => {
    const res = await api()
      .get('/api/v1/platform/users/roles')
      .set(authHeader(superAdminToken))
      .expect(200);
    const options = res.body as { slug: string; name: string }[];
    const slugs = options.map((option) => option.slug);
    // `producer` exists in both agencies but is offered once.
    expect(slugs.filter((slug) => slug === 'producer')).toHaveLength(1);
    expect(slugs).toContain('csr');
    for (const option of options) {
      expect(typeof option.name).toBe('string');
    }
  });

  it('is forbidden for a tenant user, even an owner', async () => {
    await api()
      .get('/api/v1/platform/users')
      .set(authHeader(ownerToken))
      .expect(403);
    await api()
      .get('/api/v1/platform/users/roles')
      .set(authHeader(ownerToken))
      .expect(403);
  });
});
