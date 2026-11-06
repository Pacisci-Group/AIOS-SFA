import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import {
  ANY_CARRIER,
  DEFAULT_PRODUCER_OF_YEAR,
  DEFAULT_SALESPERSON_OF_MONTH,
  DEFAULT_TEAM_BONUS,
  MAX_PAYOUT_AMOUNT,
  PAYMENT_STRUCTURE_NAME_TAKEN,
  PAYMENT_STRUCTURE_STALE,
  type PaymentStructureSummary,
  type PaymentStructureView,
  type PaymentStructuresResponse,
  type PayoutPeopleResponse,
  type PayoutSettingsView,
  type UpsertPaymentStructureInput,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { LeadSource } from '../src/lead-sources/schemas/lead-source.schema';
import { PaymentStructure } from '../src/payouts/schemas/payment-structure.schema';
import { RoleAssignmentsService } from '../src/permissions/role-assignments.service';
import { Agency } from '../src/platform/schemas/agency.schema';
import { AgencyRole } from '../src/roles/schemas/agency-role.schema';
import { User } from '../src/users/schemas/user.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  seedTestData,
  TEST_PASSWORD,
  type TestSeedContext,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

/**
 * PAC-177 — payout settings and payment structures.
 *
 * The owner sets the team bonus and Salesperson of the Month, and builds
 * structures (rates per carrier, lead-source overrides, hat trick, tiers,
 * members). A person is on one structure at most; nobody below
 * `agency:payouts:admin` touches any of it — the Branch Manager included.
 */
/** A flat rate as the API serves it: no steps (2026 comp plans). */
const flat = <T extends object>(rule: T) => ({
  ...rule,
  stepBasis: 'premium',
  steps: [],
});

describe('Payouts — settings and structures (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let ownerToken: string;
  let producerToken: string;
  let managerToken: string;
  let producerId: string;
  let csrId: string;
  let formerId: string;
  let structures: Model<PaymentStructure>;
  let agencies: Model<Agency>;

  const api = () => request(app.getHttpServer());

  const structureBody = (
    overrides: Partial<UpsertPaymentStructureInput> = {},
  ): UpsertPaymentStructureInput => ({
    name: 'Producers',
    rules: [
      { carrier: 'Allstate', ratePercent: 10 },
      { carrier: ANY_CARRIER, ratePercent: 5 },
    ],
    leadSourceRules: [],
    hatTrick: { enabled: true, dealsPerDay: 3, bonusAmount: 50 },
    individualTiers: [
      { thresholdPremium: 50_000, bonusAmount: 500 },
      { thresholdPremium: 25_000, bonusAmount: 250 },
    ],
    tiersStackable: false,
    teamBonusEligible: true,
    memberIds: [],
    ...overrides,
  });

  const create = (body: UpsertPaymentStructureInput, token = ownerToken) =>
    api().post('/api/v1/payouts/structures').set(authHeader(token)).send(body);

  /** PATCH, saying which version of the structure the edit started from. */
  const update = (
    id: string,
    body: UpsertPaymentStructureInput,
    expectedUpdatedAt: string,
  ) =>
    api()
      .patch(`/api/v1/payouts/structures/${id}`)
      .set(authHeader(ownerToken))
      .send({ ...body, expectedUpdatedAt });

  const fetchStructure = async (id: string) =>
    (
      await api()
        .get(`/api/v1/payouts/structures/${id}`)
        .set(authHeader(ownerToken))
        .expect(200)
    ).body as PaymentStructureView;

  /** Whether the seeded agency, as `create()` stored it, had `payouts`. */
  let newAgencyStoredPayouts: boolean;

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const roleModel = app.get<Model<AgencyRole>>(
      getModelToken(AgencyRole.name),
    );
    structures = app.get<Model<PaymentStructure>>(
      getModelToken(PaymentStructure.name),
    );
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    const roleAssignments = app.get(RoleAssignmentsService);

    // Read raw, before any test writes: `seedTestData` creates the agency
    // through a hydrated `agencyModel.create()`, which is where a schema
    // default would have written the payout settings in.
    const stored = await agencies.collection.findOne({
      _id: new Types.ObjectId(seed.agencyId),
    });
    newAgencyStoredPayouts = Boolean(stored && 'payouts' in stored);

    const producer = await userModel
      .findOne({ email: seed.producerEmail })
      .select('+passwordHash');
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    producerId = producer!._id.toString();
    csrId = seed.csrUserId;

    const agencyId = new Types.ObjectId(seed.agencyId);
    const branchId = new Types.ObjectId(seed.branchId);
    const roles = await roleModel.find({ agencyId }).lean();
    const roleId = (slug: string) =>
      roles.find((role) => role.slug === slug)!._id;
    const seedActor = { userId: owner!._id.toString(), isPlatformAdmin: true };
    const person = async (
      email: string,
      slug: string,
      extra: Record<string, unknown> = {},
    ) => {
      const user = await userModel.create({
        agencyId,
        branchId,
        email,
        passwordHash: (producer as unknown as { passwordHash: string })
          .passwordHash,
        firstName: email.split('@')[0],
        lastName: 'Fixture',
        isActive: true,
        ...extra,
      });
      await roleAssignments.setUserRoles(seedActor, agencyId, user._id, [
        roleId(slug),
      ]);
      return user._id.toString();
    };
    const managerEmail = 'payouts-manager@sfa.local';
    await person(managerEmail, 'branch_manager');
    formerId = await person('payouts-former@sfa.local', 'producer', {
      isActive: false,
      deactivatedAt: new Date(),
    });

    ownerToken = (await login(app, seed.ownerEmail, TEST_PASSWORD)).accessToken;
    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    managerToken = (await login(app, managerEmail, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await structures.deleteMany({});
    await agencies.updateOne(
      { _id: seed.agencyId },
      { $unset: { payouts: 1 } },
    );
  });

  describe('settings', () => {
    it('stores nothing on a new agency, and serves it the defaults', async () => {
      expect(newAgencyStoredPayouts).toBe(false);
      const body = (
        await api()
          .get('/api/v1/payouts/settings')
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PayoutSettingsView;
      expect(body).toEqual({
        teamBonus: DEFAULT_TEAM_BONUS,
        salespersonOfMonth: DEFAULT_SALESPERSON_OF_MONTH,
        producerOfYear: DEFAULT_PRODUCER_OF_YEAR,
      });
    });

    it('serves the defaults to an agency that never saved them', async () => {
      const body = (
        await api()
          .get('/api/v1/payouts/settings')
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PayoutSettingsView;
      expect(body.teamBonus).toEqual(DEFAULT_TEAM_BONUS);
      expect(body.salespersonOfMonth).toEqual({
        enabled: false,
        bonusAmount: 0,
      });
    });

    it('saves each section whole, and leaves the other alone', async () => {
      const teamBonus = {
        enabled: true,
        stackable: false,
        levels: [{ thresholdPremium: 300_000, poolAmount: 5_000 }],
        csrSharePercent: 25,
        producerSharePercent: 75,
      };
      await api()
        .patch('/api/v1/payouts/settings')
        .set(authHeader(ownerToken))
        .send({ teamBonus })
        .expect(200);
      const body = (
        await api()
          .patch('/api/v1/payouts/settings')
          .set(authHeader(ownerToken))
          .send({ salespersonOfMonth: { enabled: true, bonusAmount: 250 } })
          .expect(200)
      ).body as PayoutSettingsView;
      expect(body.teamBonus).toEqual(teamBonus);
      expect(body.salespersonOfMonth).toEqual({
        enabled: true,
        bonusAmount: 250,
      });
    });

    it('refuses shares that do not add up to 100', async () => {
      const res = await api()
        .patch('/api/v1/payouts/settings')
        .set(authHeader(ownerToken))
        .send({
          teamBonus: { ...DEFAULT_TEAM_BONUS, csrSharePercent: 30 },
        })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain(
        'The CSR and producer shares must add up to 100%.',
      );
    });

    it('stores stacking team levels lowest threshold first', async () => {
      // The owner's example: $300,000 → $3,000, and another $3,000 at $350,000.
      const body = (
        await api()
          .patch('/api/v1/payouts/settings')
          .set(authHeader(ownerToken))
          .send({
            teamBonus: {
              ...DEFAULT_TEAM_BONUS,
              enabled: true,
              stackable: true,
              levels: [
                { thresholdPremium: 350_000, poolAmount: 1_000 },
                { thresholdPremium: 300_000, poolAmount: 3_000 },
              ],
            },
          })
          .expect(200)
      ).body as PayoutSettingsView;
      expect(body.teamBonus.stackable).toBe(true);
      expect(body.teamBonus.levels).toEqual([
        { thresholdPremium: 300_000, poolAmount: 3_000 },
        { thresholdPremium: 350_000, poolAmount: 1_000 },
      ]);
    });

    it('refuses team levels the rules do not allow', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [
          { ...DEFAULT_TEAM_BONUS, enabled: true, levels: [] },
          'Add at least one team bonus level.',
        ],
        [
          {
            ...DEFAULT_TEAM_BONUS,
            levels: [
              { thresholdPremium: 300_000, poolAmount: 3_000 },
              { thresholdPremium: 300_000, poolAmount: 4_000 },
            ],
          },
          'Two levels have the same threshold.',
        ],
        [
          {
            ...DEFAULT_TEAM_BONUS,
            stackable: false,
            levels: [
              { thresholdPremium: 300_000, poolAmount: 3_000 },
              { thresholdPremium: 350_000, poolAmount: 1_000 },
            ],
          },
          'A higher level cannot pay less than the level below it, unless the levels stack.',
        ],
      ];
      for (const [teamBonus, message] of cases) {
        const res = await api()
          .patch('/api/v1/payouts/settings')
          .set(authHeader(ownerToken))
          .send({ teamBonus })
          .expect(400);
        expect(JSON.stringify(res.body)).toContain(message);
      }
      // The old single-threshold shape is gone.
      await api()
        .patch('/api/v1/payouts/settings')
        .set(authHeader(ownerToken))
        .send({
          teamBonus: {
            enabled: false,
            thresholdPremium: 300_000,
            poolAmount: 0,
            csrSharePercent: 20,
            producerSharePercent: 80,
          },
        })
        .expect(400);
    });

    it('refuses an empty body and an unknown field', async () => {
      await api()
        .patch('/api/v1/payouts/settings')
        .set(authHeader(ownerToken))
        .send({})
        .expect(400);
      await api()
        .patch('/api/v1/payouts/settings')
        .set(authHeader(ownerToken))
        .send({ teamBonus: { ...DEFAULT_TEAM_BONUS, extra: 1 } })
        .expect(400);
    });
  });

  describe('structures', () => {
    it('creates a structure with sorted tiers, canonical carriers and members', async () => {
      const body = (
        await create(
          structureBody({
            rules: [
              { carrier: ANY_CARRIER, ratePercent: 5 },
              { carrier: 'B4tEH', ratePercent: 10 },
            ],
            memberIds: [producerId, csrId],
          }),
        ).expect(201)
      ).body as PaymentStructureView;

      expect(body.name).toBe('Producers');
      expect(body.status).toBe('active');
      expect(body.rules).toEqual(
        [
          { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: null },
          { carrier: ANY_CARRIER, ratePercent: 5, minBundleRatePercent: null },
        ].map(flat),
      );
      expect(body.individualTiers.map((t) => t.thresholdPremium)).toEqual([
        25_000, 50_000,
      ]);
      expect(body.memberCount).toBe(2);
      expect(body.members.map((m) => m.id).sort()).toEqual(
        [producerId, csrId].sort(),
      );
      expect(body.members.every((m) => m.status === 'active')).toBe(true);
      expect(body.members.find((m) => m.id === producerId)!.roles).toEqual([
        'Producer',
      ]);
    });

    it('moves a person who joins a second structure', async () => {
      const first = (
        await create(structureBody({ memberIds: [producerId, csrId] })).expect(
          201,
        )
      ).body as PaymentStructureView;

      const people = (
        await api()
          .get('/api/v1/payouts/structures/people')
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PayoutPeopleResponse;
      expect(people.people.find((p) => p.id === producerId)!.structure).toEqual(
        { id: first.id, name: 'Producers' },
      );
      // A removed person is not offered.
      expect(people.people.some((p) => p.id === formerId)).toBe(false);

      await create(
        structureBody({ name: 'Senior producers', memberIds: [producerId] }),
      ).expect(201);

      const after = (
        await api()
          .get(`/api/v1/payouts/structures/${first.id}`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PaymentStructureView;
      expect(after.members.map((m) => m.id)).toEqual([csrId]);

      const list = (
        await api()
          .get('/api/v1/payouts/structures')
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PaymentStructuresResponse;
      expect(list.structures.map((s) => [s.name, s.memberCount])).toEqual([
        ['Producers', 1],
        ['Senior producers', 1],
      ]);
    });

    it('updates the whole structure, and moving there takes people off the other', async () => {
      const a = (
        await create(
          structureBody({ name: 'A', memberIds: [producerId] }),
        ).expect(201)
      ).body as PaymentStructureView;
      const b = (
        await create(structureBody({ name: 'B', memberIds: [csrId] })).expect(
          201,
        )
      ).body as PaymentStructureView;

      const updated = (
        await update(
          b.id,
          structureBody({
            name: 'B renamed',
            rules: [{ carrier: 'Allstate', ratePercent: 12.5 }],
            memberIds: [csrId, producerId],
          }),
          b.updatedAt,
        ).expect(200)
      ).body as PaymentStructureView;
      expect(updated.name).toBe('B renamed');
      expect(updated.rules).toEqual([
        flat({
          carrier: 'Allstate',
          ratePercent: 12.5,
          minBundleRatePercent: null,
        }),
      ]);
      expect(updated.memberCount).toBe(2);
      expect(updated.members.map((m) => m.id).sort()).toEqual(
        [csrId, producerId].sort(),
      );
      expect(updated.updatedAt).not.toBe(b.updatedAt);

      const stored = await structures.findById(a.id).lean();
      expect(stored!.memberIds).toEqual([]);
    });

    it('refuses an update that does not say which version it replaces', async () => {
      const created = (await create(structureBody()).expect(201))
        .body as PaymentStructureView;
      await api()
        .patch(`/api/v1/payouts/structures/${created.id}`)
        .set(authHeader(ownerToken))
        .send(structureBody())
        .expect(400);
    });

    it('refuses an update from a stale copy, so a second tab cannot overwrite the first', async () => {
      const created = (await create(structureBody()).expect(201))
        .body as PaymentStructureView;
      await update(
        created.id,
        structureBody({ teamBonusEligible: false }),
        created.updatedAt,
      ).expect(200);

      const res = await update(
        created.id,
        structureBody({ name: 'Second tab' }),
        created.updatedAt,
      ).expect(409);
      expect(res.body).toMatchObject({
        code: PAYMENT_STRUCTURE_STALE,
        message:
          'This structure was changed somewhere else. Reload to see the latest version.',
      });
      const stored = await fetchStructure(created.id);
      expect(stored.name).toBe('Producers');
      expect(stored.teamBonusEligible).toBe(false);
    });

    it('refuses to put back a member another structure took since the page loaded', async () => {
      // The editor's data-loss case: A is open with the producer ticked;
      // meanwhile B is saved with the producer, moving them off A.
      const a = (
        await create(
          structureBody({ name: 'A', memberIds: [producerId] }),
        ).expect(201)
      ).body as PaymentStructureView;
      const b = (await create(structureBody({ name: 'B' })).expect(201))
        .body as PaymentStructureView;
      await update(
        b.id,
        structureBody({ name: 'B', memberIds: [producerId] }),
        b.updatedAt,
      ).expect(200);

      const res = await update(
        a.id,
        structureBody({ name: 'A', memberIds: [producerId] }),
        a.updatedAt,
      ).expect(409);
      expect((res.body as { code?: string }).code).toBe(
        PAYMENT_STRUCTURE_STALE,
      );
      expect((await fetchStructure(a.id)).members).toEqual([]);
      expect((await fetchStructure(b.id)).members.map((m) => m.id)).toEqual([
        producerId,
      ]);
    });

    it('keeps a person on one structure when two saves add them at once', async () => {
      // Each round races two creates that both include the producer. Without
      // the per-agency write lock both transactions commit and the producer
      // ends up on two active structures.
      for (let round = 0; round < 5; round += 1) {
        await structures.deleteMany({});
        const results = await Promise.all([
          create(
            structureBody({ name: `One ${round}`, memberIds: [producerId] }),
          ),
          create(
            structureBody({
              name: `Two ${round}`,
              memberIds: [producerId, csrId],
            }),
          ),
        ]);
        expect(results.map((res) => res.status)).toEqual([201, 201]);
        const holding = await structures
          .find({ status: 'active', memberIds: new Types.ObjectId(producerId) })
          .lean();
        expect(holding).toHaveLength(1);
      }
    });

    it('stores only what the rules allow, on update paths too', async () => {
      const created = (await create(structureBody()).expect(201))
        .body as PaymentStructureView;
      const write = (set: Record<string, unknown>) =>
        structures.updateOne(
          { _id: created.id },
          { $set: set },
          { runValidators: true },
        );
      await expect(
        write({ hatTrick: { enabled: true, dealsPerDay: 1, bonusAmount: 50 } }),
      ).rejects.toThrow(/dealsPerDay/);
      await expect(
        write({
          hatTrick: { enabled: true, dealsPerDay: 2.5, bonusAmount: 50 },
        }),
      ).rejects.toThrow(/whole number/);
      await expect(
        write({
          hatTrick: { enabled: true, dealsPerDay: 3, bonusAmount: 10.555 },
        }),
      ).rejects.toThrow(/two decimals/);
      await expect(
        write({
          individualTiers: [
            { thresholdPremium: MAX_PAYOUT_AMOUNT + 1, bonusAmount: 1 },
          ],
        }),
      ).rejects.toThrow(/thresholdPremium/);
      await expect(
        write({ rules: [{ carrier: 'Allstate', ratePercent: 10.125 }] }),
      ).rejects.toThrow(/two decimals/);
      await expect(
        write({
          rules: [
            {
              carrier: 'Allstate',
              ratePercent: 10,
              minBundleRatePercent: 83.125,
            },
          ],
        }),
      ).rejects.toThrow(/two decimals/);
      await expect(
        write({
          rules: [
            { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 101 },
          ],
        }),
      ).rejects.toThrow(/minBundleRatePercent/);
      // `null` is "not enforced", and stores.
      await write({
        rules: [
          { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: null },
        ],
      });
    });

    it('refuses invalid rules with the shared messages', async () => {
      const cases: [Partial<UpsertPaymentStructureInput>, string][] = [
        [{ rules: [] }, 'Add at least one commission rate.'],
        [
          {
            rules: [
              { carrier: 'Allstate', ratePercent: 10 },
              { carrier: 'allstate', ratePercent: 11 },
            ],
          },
          'Allstate has more than one rate.',
        ],
        [
          {
            rules: [
              { carrier: ANY_CARRIER, ratePercent: 5 },
              { carrier: ANY_CARRIER, ratePercent: 6 },
            ],
          },
          'Only one "any other carrier" rate is allowed.',
        ],
        [
          { rules: [{ carrier: 'Allstate', ratePercent: 120 }] },
          'The Allstate rate must be between 0 and 100.',
        ],
        [
          {
            individualTiers: [
              { thresholdPremium: 25_000, bonusAmount: 250 },
              { thresholdPremium: 25_000, bonusAmount: 300 },
            ],
          },
          'Two tiers have the same threshold.',
        ],
        [
          { hatTrick: { enabled: true, dealsPerDay: 1, bonusAmount: 50 } },
          'Sales in a day must be a whole number from 2 to 20.',
        ],
        [
          {
            individualTiers: [
              { thresholdPremium: 25_000, bonusAmount: 250 },
              { thresholdPremium: 50_000, bonusAmount: 100 },
            ],
          },
          'A higher tier cannot pay less than the tier below it, unless the tiers stack.',
        ],
        [
          {
            rules: [
              { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 0 },
            ],
          },
          'The Allstate minimum bundle rate must be more than 0%.',
        ],
        [
          {
            rules: [
              {
                carrier: ANY_CARRIER,
                ratePercent: 5,
                minBundleRatePercent: 101,
              },
            ],
          },
          'The "any other carrier" minimum bundle rate must be between 0 and 100.',
        ],
      ];
      for (const [overrides, message] of cases) {
        const res = await create(structureBody(overrides)).expect(400);
        expect(JSON.stringify(res.body)).toContain(
          JSON.stringify(message).slice(1, -1),
        );
      }
    });

    it('stores stacking tiers and minimum bundle rates, and reads them back', async () => {
      const created = (
        await create(
          structureBody({
            rules: [
              { carrier: ANY_CARRIER, ratePercent: 5 },
              { carrier: 'B4tEH', ratePercent: 10, minBundleRatePercent: 83 },
            ],
            // Stacked, a higher tier may add a smaller extra amount.
            individualTiers: [
              { thresholdPremium: 25_000, bonusAmount: 250 },
              { thresholdPremium: 50_000, bonusAmount: 100 },
            ],
            tiersStackable: true,
          }),
        ).expect(201)
      ).body as PaymentStructureView;
      expect(created.tiersStackable).toBe(true);
      // A rule sent without a minimum reads back as `null`.
      expect(created.rules).toEqual(
        [
          { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 83 },
          { carrier: ANY_CARRIER, ratePercent: 5, minBundleRatePercent: null },
        ].map(flat),
      );
      expect(await fetchStructure(created.id)).toMatchObject({
        tiersStackable: true,
        rules: created.rules,
      });

      // Turning both off is a whole-structure save like any other.
      const updated = (
        await update(
          created.id,
          structureBody({
            rules: [
              {
                carrier: 'Allstate',
                ratePercent: 10,
                minBundleRatePercent: null,
              },
              { carrier: ANY_CARRIER, ratePercent: 5 },
            ],
          }),
          created.updatedAt,
        ).expect(200)
      ).body as PaymentStructureView;
      expect(updated.tiersStackable).toBe(false);
      expect(updated.rules.map((r) => r.minBundleRatePercent)).toEqual([
        null,
        null,
      ]);
    });

    it('refuses a body without tiersStackable: the whole structure is sent', async () => {
      const { tiersStackable: _omitted, ...body } = structureBody();
      void _omitted;
      await create(body as UpsertPaymentStructureInput).expect(400);
    });

    it('reads a structure saved before stacking and minimums existed as off', async () => {
      const created = (await create(structureBody()).expect(201))
        .body as PaymentStructureView;
      await structures.collection.updateOne(
        { _id: new Types.ObjectId(created.id) },
        {
          $unset: {
            tiersStackable: 1,
            'rules.0.minBundleRatePercent': 1,
            'rules.1.minBundleRatePercent': 1,
          },
        },
      );
      const loaded = await fetchStructure(created.id);
      expect(loaded.tiersStackable).toBe(false);
      expect(loaded.rules.every((r) => r.minBundleRatePercent === null)).toBe(
        true,
      );
    });

    it('refuses a name already used by an active structure, case-insensitively', async () => {
      await create(structureBody({ name: 'Producers' })).expect(201);
      const res = await create(structureBody({ name: '  producers ' })).expect(
        409,
      );
      expect((res.body as { code?: string }).code).toBe(
        PAYMENT_STRUCTURE_NAME_TAKEN,
      );
    });

    it('refuses to add someone removed from the agency, or from another agency', async () => {
      await create(structureBody({ memberIds: [formerId] })).expect(400);
      await create(
        structureBody({ memberIds: [new Types.ObjectId().toString()] }),
      ).expect(400);
    });

    it('keeps a member who was removed after joining, shown as removed', async () => {
      const created = (
        await create(structureBody({ memberIds: [producerId] })).expect(201)
      ).body as PaymentStructureView;
      // Simulate the departure without touching the seeded producer.
      await structures.updateOne(
        { _id: created.id },
        { $push: { memberIds: new Types.ObjectId(formerId) } },
      );
      const loaded = await fetchStructure(created.id);
      const saved = (
        await update(
          created.id,
          structureBody({ memberIds: [producerId, formerId] }),
          loaded.updatedAt,
        ).expect(200)
      ).body as PaymentStructureView;
      expect(saved.memberCount).toBe(1);
      expect(saved.members.find((m) => m.id === formerId)!.status).toBe(
        'deactivated',
      );
    });

    it('archives a structure, releases its members and frees its name', async () => {
      const created = (
        await create(structureBody({ memberIds: [producerId] })).expect(201)
      ).body as PaymentStructureView;
      const archived = (
        await api()
          .post(`/api/v1/payouts/structures/${created.id}/archive`)
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PaymentStructureSummary;
      expect(archived.status).toBe('archived');
      expect(archived.memberCount).toBe(0);

      await api()
        .post(`/api/v1/payouts/structures/${created.id}/archive`)
        .set(authHeader(ownerToken))
        .expect(409);
      // Archived beats stale: the page should say it is archived, not "reload".
      const refused = await update(
        created.id,
        structureBody(),
        created.updatedAt,
      ).expect(409);
      expect((refused.body as { message?: string }).message).toBe(
        'This structure is archived.',
      );

      const list = (
        await api()
          .get('/api/v1/payouts/structures')
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PaymentStructuresResponse;
      expect(list.structures).toEqual([]);
      await create(structureBody({ name: 'Producers' })).expect(201);
    });

    it('answers 404 for another agency’s or an unknown id', async () => {
      await api()
        .get(`/api/v1/payouts/structures/${new Types.ObjectId().toString()}`)
        .set(authHeader(ownerToken))
        .expect(404);
      await api()
        .get('/api/v1/payouts/structures/not-an-id')
        .set(authHeader(ownerToken))
        .expect(400);
    });
  });

  describe('lead-source rates', () => {
    /** The agency's own sources, a platform one, and one it may not use. */
    let jyaId: string;
    let mailJyaId: string;
    let archivedId: string;
    let otherAgencyJyaId: string;
    let mailerId: string;
    let leadSources: Model<LeadSource>;

    beforeAll(async () => {
      leadSources = app.get<Model<LeadSource>>(getModelToken(LeadSource.name));
      const row = async (
        agencyId: string | null,
        slug: string,
        name: string,
        active = true,
      ) =>
        (
          await leadSources.create({ agencyId, slug, name, active })
        )._id.toString();
      jyaId = await row(seed.agencyId, 'jya', 'JYA');
      mailJyaId = await row(seed.agencyId, 'mail-jya', 'Mail-JYA');
      archivedId = await row(seed.agencyId, 'old-vendor', 'Old Vendor', false);
      otherAgencyJyaId = await row(
        new Types.ObjectId().toString(),
        'jya',
        'JYA',
      );
      mailerId = seed.leadSourceIds.mailer;
    });

    it('stores the overrides normalised and serves them named, by source name', async () => {
      const body = (
        await create(
          structureBody({
            leadSourceRules: [
              { leadSourceId: mailerId, carrier: ANY_CARRIER, ratePercent: 4 },
              { leadSourceId: jyaId, carrier: ANY_CARRIER, ratePercent: 5 },
              {
                leadSourceId: jyaId.toUpperCase(),
                carrier: 'B4tEH',
                ratePercent: 6,
              },
              { leadSourceId: mailJyaId, carrier: ANY_CARRIER, ratePercent: 5 },
            ],
          }),
        ).expect(201)
      ).body as PaymentStructureView;

      expect(body.leadSourceRules).toEqual([
        {
          leadSourceId: jyaId,
          leadSourceName: 'JYA',
          carrier: 'Allstate',
          ratePercent: 6,
        },
        {
          leadSourceId: jyaId,
          leadSourceName: 'JYA',
          carrier: ANY_CARRIER,
          ratePercent: 5,
        },
        {
          leadSourceId: mailJyaId,
          leadSourceName: 'Mail-JYA',
          carrier: ANY_CARRIER,
          ratePercent: 5,
        },
        {
          leadSourceId: mailerId,
          leadSourceName: 'Mailer',
          carrier: ANY_CARRIER,
          ratePercent: 4,
        },
      ]);
      // The carrier rates are untouched by the overrides.
      expect(body.rules).toEqual(
        structureBody().rules.map((rule) =>
          flat({ ...rule, minBundleRatePercent: null }),
        ),
      );

      // Stored by reference only: an ObjectId, never a copy of the name.
      const stored = await structures.collection.findOne({
        _id: new Types.ObjectId(body.id),
      });
      const storedRules = stored!.leadSourceRules as Record<string, unknown>[];
      expect(storedRules).toHaveLength(4);
      expect(storedRules.every((rule) => !('leadSourceName' in rule))).toBe(
        true,
      );
      expect(storedRules[0].leadSourceId).toBeInstanceOf(Types.ObjectId);

      // The list and the detail read name them the same way.
      expect((await fetchStructure(body.id)).leadSourceRules).toEqual(
        body.leadSourceRules,
      );
      const list = (
        await api()
          .get('/api/v1/payouts/structures')
          .set(authHeader(ownerToken))
          .expect(200)
      ).body as PaymentStructuresResponse;
      expect(list.structures[0].leadSourceRules).toEqual(body.leadSourceRules);
    });

    it('replaces the overrides on update, and clears them with an empty list', async () => {
      const created = (
        await create(
          structureBody({
            leadSourceRules: [
              { leadSourceId: jyaId, carrier: ANY_CARRIER, ratePercent: 5 },
            ],
          }),
        ).expect(201)
      ).body as PaymentStructureView;
      const changed = (
        await update(
          created.id,
          structureBody({
            leadSourceRules: [
              { leadSourceId: jyaId, carrier: ANY_CARRIER, ratePercent: 7.5 },
            ],
          }),
          created.updatedAt,
        ).expect(200)
      ).body as PaymentStructureView;
      expect(changed.leadSourceRules).toEqual([
        {
          leadSourceId: jyaId,
          leadSourceName: 'JYA',
          carrier: ANY_CARRIER,
          ratePercent: 7.5,
        },
      ]);
      const cleared = (
        await update(
          created.id,
          structureBody({ leadSourceRules: [] }),
          changed.updatedAt,
        ).expect(200)
      ).body as PaymentStructureView;
      expect(cleared.leadSourceRules).toEqual([]);
    });

    it('refuses a body without the field: the whole structure is sent', async () => {
      const { leadSourceRules: _omitted, ...body } = structureBody();
      void _omitted;
      await create(body as UpsertPaymentStructureInput).expect(400);
    });

    it('refuses two rates for one source and carrier, with the shared message', async () => {
      const res = await create(
        structureBody({
          leadSourceRules: [
            { leadSourceId: jyaId, carrier: 'Allstate', ratePercent: 5 },
            { leadSourceId: jyaId, carrier: 'allstate', ratePercent: 6 },
          ],
        }),
      ).expect(400);
      expect(JSON.stringify(res.body)).toContain(
        'Lead-source rates 1 and 2 both set a rate for Allstate from the same lead source.',
      );
      await create(
        structureBody({
          leadSourceRules: [
            { leadSourceId: jyaId, carrier: ANY_CARRIER, ratePercent: 5 },
            { leadSourceId: jyaId, carrier: ANY_CARRIER, ratePercent: 6 },
          ],
        }),
      ).expect(400);
      await create(
        structureBody({
          leadSourceRules: [
            { leadSourceId: jyaId, carrier: ANY_CARRIER, ratePercent: 101 },
          ],
        }),
      ).expect(400);
      await create(
        structureBody({
          leadSourceRules: [
            { leadSourceId: 'not-an-id', carrier: ANY_CARRIER, ratePercent: 5 },
          ],
        }),
      ).expect(400);
    });

    it('refuses a source with no row, and another agency’s', async () => {
      for (const leadSourceId of [
        new Types.ObjectId().toString(),
        otherAgencyJyaId,
      ]) {
        const res = await create(
          structureBody({
            leadSourceRules: [
              { leadSourceId, carrier: ANY_CARRIER, ratePercent: 5 },
            ],
          }),
        ).expect(400);
        expect((res.body as { message?: string }).message).toBe(
          'Some lead sources chosen are not available to this agency.',
        );
      }
      expect(await structures.countDocuments({})).toBe(0);
    });

    it('refuses to add an archived source, but keeps one already on the structure, named', async () => {
      const refused = await create(
        structureBody({
          leadSourceRules: [
            { leadSourceId: archivedId, carrier: ANY_CARRIER, ratePercent: 5 },
          ],
        }),
      ).expect(400);
      expect((refused.body as { message?: string }).message).toBe(
        'Old Vendor has been archived and cannot be added.',
      );

      // A rule saved while the source was active, which was archived since.
      const created = (
        await create(
          structureBody({
            leadSourceRules: [
              { leadSourceId: jyaId, carrier: ANY_CARRIER, ratePercent: 5 },
            ],
          }),
        ).expect(201)
      ).body as PaymentStructureView;
      await leadSources.updateOne({ _id: jyaId }, { $set: { active: false } });
      try {
        const loaded = await fetchStructure(created.id);
        expect(loaded.leadSourceRules).toEqual([
          {
            leadSourceId: jyaId,
            leadSourceName: 'JYA',
            carrier: ANY_CARRIER,
            ratePercent: 5,
          },
        ]);
        // Re-saving the structure as loaded keeps the rule.
        const saved = (
          await update(
            created.id,
            structureBody({
              name: 'Renamed',
              leadSourceRules: loaded.leadSourceRules.map(
                ({ leadSourceId, carrier, ratePercent }) => ({
                  leadSourceId,
                  carrier,
                  ratePercent,
                }),
              ),
            }),
            loaded.updatedAt,
          ).expect(200)
        ).body as PaymentStructureView;
        expect(saved.leadSourceRules.map((r) => r.leadSourceName)).toEqual([
          'JYA',
        ]);
      } finally {
        await leadSources.updateOne({ _id: jyaId }, { $set: { active: true } });
      }
    });

    it('reads a structure saved before the field existed as having none', async () => {
      const created = (await create(structureBody()).expect(201))
        .body as PaymentStructureView;
      await structures.collection.updateOne(
        { _id: new Types.ObjectId(created.id) },
        { $unset: { leadSourceRules: 1 } },
      );
      expect((await fetchStructure(created.id)).leadSourceRules).toEqual([]);
    });

    it('stores only what the rules allow, on update paths too', async () => {
      const created = (await create(structureBody()).expect(201))
        .body as PaymentStructureView;
      await expect(
        structures.updateOne(
          { _id: created.id },
          {
            $set: {
              leadSourceRules: [
                { leadSourceId: jyaId, carrier: '*', ratePercent: 5.555 },
              ],
            },
          },
          { runValidators: true },
        ),
      ).rejects.toThrow(/two decimals/);
    });
  });

  describe('permissions', () => {
    it.each([
      ['GET', '/api/v1/payouts/settings'],
      ['PATCH', '/api/v1/payouts/settings'],
      ['GET', '/api/v1/payouts/structures'],
      ['GET', '/api/v1/payouts/structures/people'],
      ['POST', '/api/v1/payouts/structures'],
    ])(
      'refuses %s %s to a producer and a branch manager',
      async (method, url) => {
        for (const token of [producerToken, managerToken]) {
          const req =
            method === 'GET'
              ? api().get(url)
              : method === 'PATCH'
                ? api()
                    .patch(url)
                    .send({
                      salespersonOfMonth: { enabled: false, bonusAmount: 0 },
                    })
                : api().post(url).send(structureBody());
          await req.set(authHeader(token)).expect(403);
        }
      },
    );

    it('is closed when the module is switched off', async () => {
      await agencies.updateOne(
        { _id: seed.agencyId },
        { $set: { 'modules.payouts.enabled': false } },
      );
      try {
        await api()
          .get('/api/v1/payouts/structures')
          .set(authHeader(ownerToken))
          .expect(403);
      } finally {
        await agencies.updateOne(
          { _id: seed.agencyId },
          { $set: { 'modules.payouts.enabled': true } },
        );
      }
    });
  });
});
