import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { WorkerModule } from '../../src/worker/worker.module';
import { AccrueTimeOffFn } from '../../src/worker/functions/accrue-time-off.fn';
import { MailTransport } from '../../src/worker/email/mail-transport';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { EmployeeProfile } from '../../src/hr/schemas/employee-profile.schema';
import { LeaveLedger } from '../../src/hr/schemas/leave-ledger.schema';
import { TimeOffPolicy } from '../../src/hr/schemas/time-off-policy.schema';
import { LeaveLedgerService } from '../../src/common/time-off/leave-ledger.service';
import { inlineStep } from '../helpers/inline-step';

/**
 * `AccrueTimeOffFn` against a real MongoDB.
 *
 * The arithmetic (the twelfth, the cap, the reset pair, when a reset is
 * due) is unit-tested in `@sfa/shared`. What only the database can answer:
 * that the rows land with the right `periodKey`, `effectiveAt` and sign;
 * that a second run — the same tick repeated, another replica — writes
 * nothing (the partial unique index + upsert); that the day is the agency's
 * own (a US zone the evening before is not yet the 1st); that an archived
 * policy and a person without a hire date on an anniversary policy get
 * nothing; and that the reset runs before the grant on a day that is both.
 *
 * The sweep runs over every active agency in the shared e2e database, so the
 * assertions are on fixture rows only; every instant is in **2025**.
 */

const FIXTURE_SLUG = 'fixture-accrue-time-off';

// 2025-03-01 00:30 in Chicago (CST, UTC-6) is 06:30Z; 23:30 Chicago on
// 28 Feb is 05:30Z on 1 March — still February on the agency's calendar.
const CHICAGO_MAR_1_0030 = new Date('2025-03-01T06:30:00Z');
const CHICAGO_FEB_28_2330 = new Date('2025-03-01T05:30:00Z');
const CHICAGO_JAN_1_0100 = new Date('2025-01-01T07:00:00Z');
/** 2025-03-01T06:00:00Z — Chicago midnight on the 1st. */
const CHICAGO_MAR_1_MIDNIGHT = '2025-03-01T06:00:00.000Z';

describe('AccrueTimeOffFn (e2e)', () => {
  let app: INestApplication;
  let fn: AccrueTimeOffFn;
  let agencies: Model<Agency>;
  let policies: Model<TimeOffPolicy>;
  let ledger: Model<LeaveLedger>;
  let profiles: Model<EmployeeProfile>;
  let ledgerService: LeaveLedgerService;

  const agencyId = new Types.ObjectId();
  const alice = new Types.ObjectId();
  const bob = new Types.ObjectId();

  const policyBase = {
    agencyId: agencyId.toString(),
    archivedAt: null,
    archivedBy: null,
    timeOffType: 'pto',
    description: null,
    compensation: 'paid',
    accrualType: 'fixed_amount',
    accrualRate: null,
    accrualRateUnit: null,
    maxAccruedPerYearHours: null,
    annualUsageCapHours: null,
    waitingPeriodDays: null,
    accrualWaitingPeriodDays: null,
    allowNegativeBalance: false,
    payOutOnTermination: false,
    autoApprove: {
      enabled: false,
      maxCalendarDays: null,
      minNoticeHours: null,
    },
    createdBy: null,
    updatedBy: null,
  };

  async function reset() {
    const ids = await policies
      .find({ agencyId: agencyId.toString() })
      .distinct('_id');
    await ledger.deleteMany({ policyId: { $in: ids } });
    await policies.deleteMany({ agencyId: agencyId.toString() });
    await profiles.deleteMany({ agencyId: agencyId.toString() });
    await agencies.collection.deleteMany({ _id: agencyId });
  }

  async function insertPolicy(
    fields: Record<string, unknown>,
  ): Promise<Types.ObjectId> {
    const _id = new Types.ObjectId();
    await policies.collection.insertOne({
      _id,
      ...policyBase,
      ...fields,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    });
    return _id;
  }

  const rows = (policyId: Types.ObjectId, userId: Types.ObjectId) =>
    ledger.find({ policyId, userId }).sort({ createdAt: 1, kind: 1 }).lean<
      {
        kind: string;
        hours: number;
        periodKey: string | null;
        reason: string | null;
        effectiveAt: Date;
      }[]
    >();

  const balance = async (policyId: Types.ObjectId, userId: Types.ObjectId) =>
    (await rows(policyId, userId)).reduce((sum, row) => sum + row.hours, 0);

  const run = (now: Date) => fn.handle(inlineStep().step, now);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
        MongooseModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            uri: config.get<string>(
              'MONGODB_URI',
              'mongodb://localhost:27017/sfa_test',
            ),
          }),
        }),
        InngestModule,
        WorkerModule,
      ],
    })
      .overrideProvider(MailTransport)
      .useValue({ send: () => Promise.resolve({ providerMessageId: 'x' }) })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    fn = app.get(AccrueTimeOffFn);
    ledgerService = app.get(LeaveLedgerService);
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    policies = app.get<Model<TimeOffPolicy>>(getModelToken(TimeOffPolicy.name));
    ledger = app.get<Model<LeaveLedger>>(getModelToken(LeaveLedger.name));
    profiles = app.get<Model<EmployeeProfile>>(
      getModelToken(EmployeeProfile.name),
    );
    // The partial unique index is what makes the job idempotent; build it
    // before the first write rather than trusting autoIndex's timing.
    await ledger.syncIndexes();
  });

  afterAll(async () => {
    await reset();
    await app.close();
  });

  beforeEach(async () => {
    await reset();
    await agencies.collection.insertOne({
      _id: agencyId,
      name: 'Fixture Accrual',
      slug: FIXTURE_SLUG,
      status: 'active',
      timezone: 'America/Chicago',
    });
  });

  it('posts the twelfth on the 1st, agency time, once, clipped at the max balance', async () => {
    const policyId = await insertPolicy({
      name: 'Monthly PTO',
      hoursPerYear: 120,
      accrualFrequency: 'monthly',
      resetDateKind: 'fixed',
      resetMonthDay: '01-01',
      maxBalanceHours: 120,
      carryoverCapHours: null,
      memberIds: [alice, bob],
    });
    // Bob is nearly at the cap already.
    await ledger.create({
      agencyId: agencyId.toString(),
      policyId,
      userId: bob,
      kind: 'allocation',
      hours: 118,
      effectiveAt: new Date('2025-01-01T06:00:00Z'),
      source: { kind: 'activation', id: policyId },
    });

    // Still 28 February in Chicago: nothing.
    await run(CHICAGO_FEB_28_2330);
    expect(await rows(policyId, alice)).toHaveLength(0);

    await run(CHICAGO_MAR_1_0030);
    const aliceRows = await rows(policyId, alice);
    expect(aliceRows).toHaveLength(1);
    expect(aliceRows[0]).toMatchObject({
      kind: 'allocation',
      hours: 10,
      periodKey: 'accrual:2025-03',
      reason: null,
    });
    expect(aliceRows[0].effectiveAt.toISOString()).toBe(CHICAGO_MAR_1_MIDNIGHT);
    const bobRows = await rows(policyId, bob);
    expect(bobRows[1]).toMatchObject({
      kind: 'allocation',
      hours: 2,
      periodKey: 'accrual:2025-03',
      reason: 'max_balance',
    });

    // The same day again, an hour later: nothing new.
    const again = await run(new Date(CHICAGO_MAR_1_0030.getTime() + 3_600_000));
    expect(await rows(policyId, alice)).toHaveLength(1);
    expect(await balance(policyId, bob)).toBe(120);
    expect(again.allocations).toBe(0);
  });

  it('runs the yearly reset: expiration, carryover under the cap, then the grant', async () => {
    const policyId = await insertPolicy({
      name: 'Yearly PTO',
      hoursPerYear: 80,
      accrualFrequency: 'yearly',
      resetDateKind: 'fixed',
      resetMonthDay: '01-01',
      maxBalanceHours: null,
      carryoverCapHours: 40,
      memberIds: [alice, bob],
    });
    await ledger.create({
      agencyId: agencyId.toString(),
      policyId,
      userId: alice,
      kind: 'allocation',
      hours: 50,
      effectiveAt: new Date('2024-06-01T05:00:00Z'),
      source: { kind: 'enrollment', id: policyId },
    });
    // Bob is overdrawn: he carries the debt over.
    await ledger.create({
      agencyId: agencyId.toString(),
      policyId,
      userId: bob,
      kind: 'allocation',
      hours: -10,
      effectiveAt: new Date('2024-06-01T05:00:00Z'),
      source: { kind: 'enrollment', id: policyId },
    });

    const first = await run(CHICAGO_JAN_1_0100);
    expect(first.resets).toBeGreaterThanOrEqual(2);

    const aliceRows = await rows(policyId, alice);
    const byKind = Object.fromEntries(
      aliceRows.slice(1).map((row) => [row.kind, row]),
    );
    expect(byKind.expiration).toMatchObject({
      hours: -50,
      periodKey: 'reset:2025-01-01',
      reason: 'carryover_cap',
    });
    expect(byKind.carryover).toMatchObject({
      hours: 40,
      periodKey: 'reset:2025-01-01',
    });
    expect(byKind.allocation).toMatchObject({
      hours: 80,
      periodKey: 'accrual:2025-01-01',
      reason: null,
    });
    expect(await balance(policyId, alice)).toBe(120);
    expect(await balance(policyId, bob)).toBe(70);

    const second = await run(
      new Date(CHICAGO_JAN_1_0100.getTime() + 1_800_000),
    );
    expect(second.allocations).toBe(0);
    expect(await rows(policyId, alice)).toHaveLength(4);
    expect(await balance(policyId, alice)).toBe(120);
  });

  it('skips an archived policy, an unlimited one, and an anniversary reset with no hire date', async () => {
    const archived = await insertPolicy({
      name: 'Old PTO',
      hoursPerYear: 120,
      accrualFrequency: 'monthly',
      resetDateKind: 'fixed',
      resetMonthDay: '01-01',
      memberIds: [alice],
      archivedAt: new Date('2025-02-01T00:00:00Z'),
    });
    const unlimited = await insertPolicy({
      name: 'Unlimited',
      accrualType: 'unlimited',
      hoursPerYear: null,
      accrualFrequency: null,
      resetDateKind: null,
      resetMonthDay: null,
      memberIds: [alice],
    });
    const anniversary = await insertPolicy({
      name: 'Anniversary PTO',
      hoursPerYear: 80,
      accrualFrequency: 'yearly',
      resetDateKind: 'hire_anniversary',
      resetMonthDay: null,
      memberIds: [alice],
    });

    await run(CHICAGO_MAR_1_0030);
    expect(await rows(archived, alice)).toHaveLength(0);
    expect(await rows(unlimited, alice)).toHaveLength(0);
    expect(await rows(anniversary, alice)).toHaveLength(0);
  });

  it('runs the anniversary reset for a person whose profile has a hire date (PAC-162)', async () => {
    const anniversary = await insertPolicy({
      name: 'Anniversary PTO',
      hoursPerYear: 80,
      accrualFrequency: 'yearly',
      resetDateKind: 'hire_anniversary',
      resetMonthDay: null,
      maxBalanceHours: null,
      carryoverCapHours: 0,
      memberIds: [alice, bob],
    });
    // Alice was hired on 1 March two years earlier; Bob has no hire date.
    await profiles.create({
      agencyId: agencyId.toString(),
      userId: alice,
      status: 'active',
      hireDate: '2023-03-01',
    });
    await ledger.create({
      agencyId: agencyId.toString(),
      policyId: anniversary,
      userId: alice,
      kind: 'allocation',
      hours: 30,
      effectiveAt: new Date('2024-03-01T06:00:00Z'),
      source: { kind: 'activation', id: anniversary },
    });

    await run(CHICAGO_MAR_1_0030);
    const kinds = (await rows(anniversary, alice)).map((row) => row.kind);
    expect(kinds).toEqual([
      'allocation',
      'expiration',
      'carryover',
      'allocation',
    ]);
    expect(await balance(anniversary, alice)).toBe(80);
    expect(await rows(anniversary, bob)).toHaveLength(0);

    await run(new Date(CHICAGO_MAR_1_0030.getTime() + 3_600_000));
    expect(await rows(anniversary, alice)).toHaveLength(4);
  });

  it('closes the period on the leave that belongs to it — approved leave after the reset does not shrink the carryover (PAC-165)', async () => {
    const policyId = await insertPolicy({
      name: 'Yearly PTO',
      hoursPerYear: 80,
      accrualFrequency: 'yearly',
      resetDateKind: 'fixed',
      resetMonthDay: '01-01',
      maxBalanceHours: null,
      carryoverCapHours: 40,
      memberIds: [alice],
    });
    await ledger.create({
      agencyId: agencyId.toString(),
      policyId,
      userId: alice,
      kind: 'allocation',
      hours: 50,
      effectiveAt: new Date('2024-06-01T05:00:00Z'),
      source: { kind: 'enrollment', id: policyId },
    });
    // One request across the reset: 30 December is this period's, the reset
    // day itself and 6 January are the next one's.
    const requestId = new Types.ObjectId();
    await ledgerService.postUsed(
      { agencyId: agencyId.toString(), policyId, userId: alice, requestId },
      [
        { date: '2024-12-30', hours: 8 },
        { date: '2025-01-01', hours: 8 },
        { date: '2025-01-06', hours: 8 },
      ],
      'America/Chicago',
    );

    await run(CHICAGO_JAN_1_0100);

    const byKind = Object.fromEntries(
      (await rows(policyId, alice)).map((row) => [row.kind, row]),
    );
    // 50 − 8 closes at 42, not at 26: the cap keeps 40, two hours are lost.
    expect(byKind.expiration).toMatchObject({
      hours: -42,
      reason: 'carryover_cap',
    });
    expect(byKind.carryover).toMatchObject({ hours: 40 });
    // 40 carried + 80 granted − the 16 h of January leave.
    expect(await balance(policyId, alice)).toBe(104);
  });

  describe('LeaveLedgerService request rows (PAC-165)', () => {
    const target = (policyId: Types.ObjectId, requestId = new Types.ObjectId()) => ({
      agencyId: agencyId.toString(),
      policyId,
      userId: alice,
      requestId,
    });
    const days = [
      { date: '2025-03-06', hours: 8 },
      { date: '2025-03-07', hours: 4 },
      { date: '2025-03-08', hours: 0 }, // a Saturday inside the range
      { date: '2025-03-10', hours: 8 },
    ];
    const of = (
      map: Map<string, { current: number; upcoming: number }>,
      userId: Types.ObjectId,
    ) => map.get(userId.toString());

    async function policyWith80Hours(): Promise<Types.ObjectId> {
      const policyId = await insertPolicy({
        name: 'Requests PTO',
        hoursPerYear: 80,
        accrualFrequency: 'yearly',
        resetDateKind: 'fixed',
        resetMonthDay: '01-01',
        memberIds: [alice],
      });
      await ledger.create({
        agencyId: agencyId.toString(),
        policyId,
        userId: alice,
        kind: 'allocation',
        hours: 80,
        effectiveAt: new Date('2025-01-01T06:00:00Z'),
        source: { kind: 'activation', id: policyId },
      });
      return policyId;
    }

    it('posts one `used` row per leave day, dated on the day, exactly once', async () => {
      const policyId = await policyWith80Hours();
      const request = target(policyId);

      expect(
        await ledgerService.postUsed(request, days, 'America/Chicago'),
      ).toBe(3);
      const used = await ledger
        .find({ policyId, kind: 'used' })
        .sort({ effectiveAt: 1 })
        .lean();
      expect(used.map((row) => row.hours)).toEqual([-8, -4, -8]);
      // 6 March in Chicago (CST, UTC−6) starts at 06:00Z.
      expect(used[0].effectiveAt.toISOString()).toBe('2025-03-06T06:00:00.000Z');
      expect(used[0].periodKey).toBe(
        `used:${request.requestId.toString()}:2025-03-06`,
      );
      expect(used[0].source).toMatchObject({ kind: 'request' });
      expect(String(used[0].source.id)).toBe(request.requestId.toString());

      // A second post of the same request is refused by the unique index.
      await expect(
        ledgerService.postUsed(request, days, 'America/Chicago'),
      ).rejects.toMatchObject({ code: 11000 });
      expect(await ledger.countDocuments({ policyId, kind: 'used' })).toBe(3);
    });

    it('splits the balance at the as-of instant: future leave is upcoming, not current', async () => {
      const policyId = await policyWith80Hours();
      await ledgerService.postUsed(target(policyId), days, 'America/Chicago');
      const read = (asOf: string) =>
        ledgerService.balances(
          agencyId.toString(),
          policyId,
          [alice, bob],
          new Date(asOf),
        );

      // Before any of it: the balance is whole and 20 h are on their way.
      expect(of(await read('2025-03-01T06:00:00Z'), alice)).toEqual({
        current: 80,
        upcoming: 20,
      });
      // As of the start of 7 March: the 6th is taken, the rest is not.
      expect(of(await read('2025-03-07T06:00:00Z'), alice)).toEqual({
        current: 72,
        upcoming: 12,
      });
      // After all of it.
      expect(of(await read('2025-04-01T05:00:00Z'), alice)).toEqual({
        current: 60,
        upcoming: 0,
      });
      // Someone with no rows is absent, and another agency's key reads nothing.
      expect(of(await read('2025-03-01T06:00:00Z'), bob)).toBeUndefined();
      expect(
        (
          await ledgerService.balances(
            new Types.ObjectId().toString(),
            policyId,
            [alice],
            new Date('2025-03-01T06:00:00Z'),
          )
        ).size,
      ).toBe(0);
    });

    it('reverses each `used` row on its own day and restores the balance', async () => {
      const policyId = await policyWith80Hours();
      const request = target(policyId);
      await ledgerService.postUsed(request, days, 'America/Chicago');

      expect(await ledgerService.postReversal(request)).toBe(3);
      const used = await ledger
        .find({ policyId, kind: 'used' })
        .sort({ effectiveAt: 1 })
        .lean();
      const reversals = await ledger
        .find({ policyId, kind: 'reversal' })
        .sort({ effectiveAt: 1 })
        .lean();
      expect(reversals.map((row) => row.hours)).toEqual([8, 4, 8]);
      reversals.forEach((row, index) => {
        expect(String(row.reversesId)).toBe(String(used[index]._id));
        expect(row.effectiveAt).toEqual(used[index].effectiveAt);
      });
      expect(reversals[0].periodKey).toBe(
        `reversal:${request.requestId.toString()}:2025-03-06`,
      );
      expect(
        of(
          await ledgerService.balances(
            agencyId.toString(),
            policyId,
            [alice],
            new Date('2025-03-01T06:00:00Z'),
          ),
          alice,
        ),
      ).toEqual({ current: 80, upcoming: 0 });
      // Nothing left to count as leave, and a second reversal is refused.
      expect(
        await ledgerService.leaveDays(agencyId.toString(), policyId, alice),
      ).toEqual([]);
      await expect(ledgerService.postReversal(request)).rejects.toMatchObject({
        code: 11000,
      });
    });

    it('reports leave per day and per request inside a window', async () => {
      const policyId = await policyWith80Hours();
      const first = target(policyId);
      const second = target(policyId);
      await ledgerService.postUsed(first, days, 'America/Chicago');
      await ledgerService.postUsed(
        second,
        [{ date: '2025-04-02', hours: 8 }],
        'America/Chicago',
      );

      const fromMarch7 = await ledgerService.leaveDays(
        agencyId.toString(),
        policyId,
        alice,
        { from: new Date('2025-03-07T06:00:00Z') },
      );
      expect(fromMarch7.map((row) => row.hours)).toEqual([4, 8, 8]);
      expect(String(fromMarch7[2].requestId)).toBe(second.requestId.toString());
      const marchOnly = await ledgerService.leaveDays(
        agencyId.toString(),
        policyId,
        alice,
        { before: new Date('2025-04-01T05:00:00Z') },
      );
      expect(marchOnly.reduce((sum, row) => sum + row.hours, 0)).toBe(20);
    });

    it('posts a manual adjustment with the admin’s reason', async () => {
      const policyId = await policyWith80Hours();
      const id = await ledgerService.postAdjustment({
        agencyId: agencyId.toString(),
        policyId,
        userId: alice,
        hours: -8.004,
        note: '  Correcting the March accrual ',
        effectiveAt: new Date('2025-03-01T06:00:00Z'),
      });
      const row = await ledger.findById(id).lean();
      expect(row).toMatchObject({
        kind: 'manual_adjustment',
        hours: -8,
        note: 'Correcting the March accrual',
        periodKey: null,
        reversesId: null,
      });
      expect(row?.source).toMatchObject({ kind: 'admin', id: null });
      expect(
        of(
          await ledgerService.balances(
            agencyId.toString(),
            policyId,
            [alice],
            new Date('2025-03-02T06:00:00Z'),
          ),
          alice,
        ),
      ).toEqual({ current: 72, upcoming: 0 });
    });
  });
});
