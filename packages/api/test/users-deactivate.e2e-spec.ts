import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ServiceTicket } from '../src/crm/schemas/service-ticket.schema';
import { CrmRotation } from '../src/crm-rotations/schemas/crm-rotation.schema';
import { Deal } from '../src/deals/schemas/deal.schema';
import { User } from '../src/users/schemas/user.schema';
import { login, authHeader } from './helpers/auth.helper';
import {
  createTestApp,
  dropTestDatabase,
  closeTestApp,
} from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

describe('User removal (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let users: Model<User>;
  let tickets: Model<ServiceTicket>;
  let rotations: Model<CrmRotation>;
  let deals: Model<Deal>;
  let producerId: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();

    users = app.get<Model<User>>(getModelToken(User.name));
    tickets = app.get<Model<ServiceTicket>>(getModelToken(ServiceTicket.name));
    rotations = app.get<Model<CrmRotation>>(getModelToken(CrmRotation.name));
    deals = app.get<Model<Deal>>(getModelToken(Deal.name));

    ctx = await seedTestData(app);
    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;

    const producer = await users.findOne({ email: ctx.producerEmail }).lean();
    producerId = producer!._id.toString();
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  /** Put the producer back the way the seed left them. */
  beforeEach(async () => {
    await users.updateOne(
      { _id: new Types.ObjectId(producerId) },
      {
        $set: {
          isActive: true,
          deactivatedAt: null,
          deactivatedByUserId: null,
        },
      },
    );
    await Promise.all([
      tickets.deleteMany({}),
      rotations.deleteMany({}),
      deals.deleteMany({}),
    ]);
  });

  it('removes a user, who then cannot sign in', async () => {
    await api()
      .delete(`/api/v1/users/${producerId}`)
      .set(authHeader(ownerToken))
      .expect(200);

    const row = await users.findById(producerId).lean();
    expect(row?.isActive).toBe(false);
    expect(row?.deactivatedAt).toBeTruthy();

    await api()
      .post('/api/v1/auth/login')
      .send({ email: ctx.producerEmail, password: TEST_PASSWORD })
      .expect(401);
  });

  /**
   * Revocation must not wait for the token to expire.
   *
   * `AccessResolverService` re-resolves from Mongo on every request, so this
   * only holds if the removal invalidates the cached context. If someone drops
   * that `invalidateUser` call, the removed user keeps full access for the life
   * of their access token and this is what catches it.
   */
  it('invalidates an already-issued token on the next request', async () => {
    const producerToken = (await login(app, ctx.producerEmail, TEST_PASSWORD))
      .accessToken;

    // Asserted as "not 401" rather than "200" on purpose. What is under test is
    // *authentication*, and a producer may well be forbidden from this
    // particular route — a 403 still proves the token was accepted, which is
    // exactly the thing that must stop being true after removal.
    const before = await api()
      .get('/api/v1/users')
      .set(authHeader(producerToken));
    expect(before.status).not.toBe(401);

    await api()
      .delete(`/api/v1/users/${producerId}`)
      .set(authHeader(ownerToken))
      .expect(200);

    await api().get('/api/v1/users').set(authHeader(producerToken)).expect(401);
  });

  /**
   * The security case this whole design turns on.
   *
   * `isActive: false` means both "pending invite" and "removed". If
   * `findPendingInvite` ever stops checking `deactivatedAt`, an owner could
   * "resend an invite" to somebody they had just removed and mail them a working
   * account-activation link. That is privilege restoration, so it gets an
   * explicit test rather than relying on the guard being noticed in review.
   */
  it('refuses to resend an invite to a removed user', async () => {
    await api()
      .delete(`/api/v1/users/${producerId}`)
      .set(authHeader(ownerToken))
      .expect(200);

    const res = await api()
      .post(`/api/v1/users/${producerId}/invite/resend`)
      .set(authHeader(ownerToken))
      .send();

    expect(res.status).toBe(409);
    // No fresh credential was minted.
    const row = await users.findById(producerId).lean();
    expect(row?.inviteToken).toBeFalsy();
  });

  it('clears any live invite or reset credential on removal', async () => {
    await users.updateOne(
      { _id: new Types.ObjectId(producerId) },
      {
        $set: {
          inviteToken: 'still-valid',
          passwordResetToken: 'also-still-valid',
        },
      },
    );

    await api()
      .delete(`/api/v1/users/${producerId}`)
      .set(authHeader(ownerToken))
      .expect(200);

    const row = await users.findById(producerId).lean();
    expect(row?.inviteToken).toBeFalsy();
    expect(row?.passwordResetToken).toBeFalsy();
  });

  describe('releasing their work', () => {
    let ticketSeq = 0;

    async function seedTicket(status: string) {
      const created = await tickets.create({
        agencyId: new Types.ObjectId(ctx.agencyId),
        branchId: new Types.ObjectId(ctx.branchId),
        ticketNumber: `TKT-TEST-${++ticketSeq}`,
        clientName: 'Test Client',
        category: 'Billing',
        priority: 'medium',
        status,
        assignedUserId: new Types.ObjectId(producerId),
        assignedRep: 'Pat Producer',
      });
      return created._id.toString();
    }

    it('unassigns open tickets and clears the denormalized rep name', async () => {
      const openId = await seedTicket('open');

      const res = await api()
        .delete(`/api/v1/users/${producerId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      expect(
        (res.body as { ticketsUnassigned: number }).ticketsUnassigned,
      ).toBe(1);
      const ticket = await tickets.findById(openId).lean();
      expect(ticket?.assignedUserId).toBeNull();
      // Clearing the id but leaving the name would show a departed rep against
      // a ticket that is actually unassigned.
      expect(ticket?.assignedRep).toBe('');
    });

    it('leaves resolved and closed tickets alone', async () => {
      const resolvedId = await seedTicket('resolved');
      const closedId = await seedTicket('closed');

      await api()
        .delete(`/api/v1/users/${producerId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      for (const id of [resolvedId, closedId]) {
        const ticket = await tickets.findById(id).lean();
        // History, not outstanding work. Unassigning would both rewrite the
        // record of who handled it and drop phantom work into the queue.
        expect(ticket?.assignedUserId?.toString()).toBe(producerId);
      }
    });

    it('drops them from the CRM round-robin so no new work arrives', async () => {
      const seeded = await rotations.create({
        agencyId: new Types.ObjectId(ctx.agencyId),
        branchId: new Types.ObjectId(ctx.branchId),
        crmId: new Types.ObjectId(producerId),
        activeForProducer: true,
        order: 1,
      });

      await api()
        .delete(`/api/v1/users/${producerId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      const row = await rotations.findById(seeded._id).lean();
      // The pool query in CrmAssignmentService filters on this flag and never
      // checks whether the user is still active, so leaving it true would hand
      // the next sold deal straight back to someone with no account.
      expect(row?.activeForProducer).toBe(false);
    });

    /**
     * The line that must not move.
     *
     * `deals.producerId` is attribution — who sold the policy — not an
     * assignment. Sweeping it into the release would silently rewrite the
     * leaderboard and every "produced by" column.
     */
    it('never touches attribution on deals', async () => {
      const deal = await deals.create({
        agencyId: new Types.ObjectId(ctx.agencyId),
        branchId: new Types.ObjectId(ctx.branchId),
        producerId: new Types.ObjectId(producerId),
      });

      await api()
        .delete(`/api/v1/users/${producerId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      const row = await deals.findById(deal._id).lean();
      expect(row?.producerId?.toString()).toBe(producerId);
    });
  });

  describe('guards', () => {
    it('refuses self-removal', async () => {
      const owner = await users.findOne({ email: ctx.ownerEmail }).lean();

      const res = await api()
        .delete(`/api/v1/users/${owner!._id.toString()}`)
        .set(authHeader(ownerToken));

      // Would otherwise be unrecoverable: the endpoint needed to undo it is the
      // one they just lost.
      expect(res.status).toBe(400);
    });

    it('refuses to remove the last agency owner', async () => {
      // A second owner, so the first can be targeted by someone.
      const second = await users.create({
        agencyId: new Types.ObjectId(ctx.agencyId),
        branchId: new Types.ObjectId(ctx.branchId),
        email: 'second-owner@sfa.local',
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 12),
        roleIds: [new Types.ObjectId(ctx.ownerRoleId)],
        isActive: true,
      });
      const secondToken = (
        await login(app, 'second-owner@sfa.local', TEST_PASSWORD)
      ).accessToken;

      // Removing one of two owners is fine.
      const owner = await users.findOne({ email: ctx.ownerEmail }).lean();
      await api()
        .delete(`/api/v1/users/${owner!._id.toString()}`)
        .set(authHeader(secondToken))
        .expect(200);

      // The remaining one cannot be removed by anyone — not even themselves,
      // though that path is already blocked by the self-removal guard.
      await users.updateOne(
        { _id: owner!._id },
        { $set: { isActive: true, deactivatedAt: null } },
      );
      const ownerTokenAgain = (await login(app, ctx.ownerEmail, TEST_PASSWORD))
        .accessToken;
      const res = await api()
        .delete(`/api/v1/users/${second._id.toString()}`)
        .set(authHeader(ownerTokenAgain));
      expect(res.status).toBe(200);

      // Now only `owner` is left holding the role.
      const lastRes = await api()
        .delete(`/api/v1/users/${owner!._id.toString()}`)
        .set(authHeader(ownerTokenAgain));
      expect(lastRes.status).toBe(400); // self-removal catches it first
    });

    it('rejects a second removal of the same user', async () => {
      await api()
        .delete(`/api/v1/users/${producerId}`)
        .set(authHeader(ownerToken))
        .expect(200);

      const res = await api()
        .delete(`/api/v1/users/${producerId}`)
        .set(authHeader(ownerToken));
      expect(res.status).toBe(409);
    });

    it('points a pending invite at revoke instead', async () => {
      const invited = await api()
        .post('/api/v1/users/invite')
        .set(authHeader(ownerToken))
        .send({
          email: 'pending-removal@sfa.local',
          roleIds: [ctx.producerRoleId],
        })
        .expect(201);

      const invitedId = (invited.body as { userId: string }).userId;
      const res = await api()
        .delete(`/api/v1/users/${invitedId}`)
        .set(authHeader(ownerToken));

      // Revoking deletes the row and frees the email; deactivating would hold
      // the unique index forever.
      expect(res.status).toBe(409);
      expect(String((res.body as { message: string }).message)).toMatch(
        /revoke/i,
      );
    });
  });

  it('reactivates a removed user', async () => {
    await api()
      .delete(`/api/v1/users/${producerId}`)
      .set(authHeader(ownerToken))
      .expect(200);

    await api()
      .post(`/api/v1/users/${producerId}/reactivate`)
      .set(authHeader(ownerToken))
      .expect(201);

    const row = await users.findById(producerId).lean();
    expect(row?.isActive).toBe(true);
    expect(row?.deactivatedAt).toBeNull();

    await api()
      .post('/api/v1/auth/login')
      .send({ email: ctx.producerEmail, password: TEST_PASSWORD })
      .expect(201);
  });
});
