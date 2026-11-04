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
});
