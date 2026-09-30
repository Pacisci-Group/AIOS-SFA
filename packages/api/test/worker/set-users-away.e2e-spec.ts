import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { WorkerModule } from '../../src/worker/worker.module';
import { SetUsersAwayFn } from '../../src/worker/functions/set-users-away.fn';
import { MailTransport } from '../../src/worker/email/mail-transport';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { User, type UserDocument } from '../../src/users/schemas/user.schema';

/**
 * `SetUsersAwayFn` against a real MongoDB.
 *
 * The decision ("is this agency due, and for which local date") is unit-tested
 * in `end-of-day.unit-spec.ts`. What only the database can answer is the rest:
 * that the claim on the agency marker really is conditional, that the user
 * filter excludes exactly who it should (`isActive`, `isPlatformAdmin`,
 * already-`away`), that an agency with no `timezone` field falls back to
 * Central time, and that `forEachAgency` skips a suspended tenant. Every one of
 * those failures is silent — a status that does not change throws nothing.
 *
 * ## The sweep is not scoped, so the assertions are
 *
 * `handle()` runs over every active agency in the database, as it does in
 * production, and the e2e database is shared with whatever else is in it. So
 * nothing here asserts a whole-run count, only what happened to the fixture
 * rows — and every instant is in **2025**, so the date marker the sweep leaves
 * on a non-fixture agency is one a real evening can never collide with.
 */

/** Runs each step inline — same seam as `sync-ticket-status.e2e-spec.ts`. */
function inlineStep() {
  return {
    run: <T>(_id: string, fn: () => Promise<T> | T): Promise<T> =>
      Promise.resolve(fn()),
  };
}

const FIXTURE_DOMAIN = 'away-fixture.local';

// 2025-09-25 in Chicago is Central Daylight Time (UTC-5): 20:00 CDT is
// 01:00Z on the 26th. Kolkata is UTC+5:30, so its 20:00 is 14:30Z.
const CHICAGO_1959 = new Date('2025-09-26T00:59:00Z');
const CHICAGO_2000 = new Date('2025-09-26T01:00:00Z');
const CHICAGO_2030 = new Date('2025-09-26T01:30:00Z');
const CHICAGO_2330 = new Date('2025-09-26T04:30:00Z');
const CHICAGO_NEXT_2000 = new Date('2025-09-27T01:00:00Z');
const KOLKATA_2000 = new Date('2025-09-25T14:30:00Z');

describe('SetUsersAwayFn (e2e)', () => {
  let app: INestApplication;
  let fn: SetUsersAwayFn;
  let users: Model<UserDocument>;
  let agencies: Model<Agency>;

  const chicagoAgencyId = new Types.ObjectId();
  const kolkataAgencyId = new Types.ObjectId();
  const legacyAgencyId = new Types.ObjectId();
  const suspendedAgencyId = new Types.ObjectId();
  const allAgencyIds = [
    chicagoAgencyId,
    kolkataAgencyId,
    legacyAgencyId,
    suspendedAgencyId,
  ];

  /**
   * Insert through the driver, bypassing Mongoose: these rows stand in for
   * users that already exist, and the sweep's filter has to be right against
   * the raw shape, not against what a hydrated document would default.
   */
  async function seedUser(opts: {
    agencyId: Types.ObjectId;
    handle: string;
    availability: 'available' | 'busy' | 'away';
    isActive?: boolean;
    isPlatformAdmin?: boolean;
  }): Promise<Types.ObjectId> {
    const id = new Types.ObjectId();
    await users.collection.insertOne({
      _id: id,
      email: `${opts.handle}@${FIXTURE_DOMAIN}`,
      passwordHash: 'fixture',
      firstName: opts.handle,
      lastName: 'Fixture',
      agencyId: opts.agencyId,
      branchId: null,
      isActive: opts.isActive ?? true,
      isPlatformAdmin: opts.isPlatformAdmin ?? false,
      availability: opts.availability,
    });
    return id;
  }

  const availabilityOf = async (id: Types.ObjectId) =>
    (
      (await users.collection.findOne({ _id: id })) as {
        availability: string;
      } | null
    )?.availability;

  const markerOf = async (id: Types.ObjectId) =>
    (
      (await agencies.collection.findOne({ _id: id })) as {
        availabilitySweep?: { lastAwayDate?: string; lastAwayAt?: Date };
      } | null
    )?.availabilitySweep;

  async function reset() {
    await users.collection.deleteMany({
      email: { $regex: `@${FIXTURE_DOMAIN.replace('.', '\\.')}$` },
    });
    await agencies.collection.deleteMany({ _id: { $in: allAgencyIds } });
  }

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

    fn = app.get(SetUsersAwayFn);
    users = app.get<Model<UserDocument>>(getModelToken(User.name));
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
  });

  afterAll(async () => {
    await reset();
    await app.close();
  });

  beforeEach(async () => {
    await reset();
    await agencies.collection.insertMany([
      {
        _id: chicagoAgencyId,
        name: 'Fixture Chicago',
        slug: 'fixture-away-chicago',
        status: 'active',
        timezone: 'America/Chicago',
      },
      {
        _id: kolkataAgencyId,
        name: 'Fixture Kolkata',
        slug: 'fixture-away-kolkata',
        status: 'active',
        timezone: 'Asia/Kolkata',
      },
      {
        // Predates the field: no `timezone`, no `availabilitySweep`.
        _id: legacyAgencyId,
        name: 'Fixture Legacy',
        slug: 'fixture-away-legacy',
        status: 'active',
      },
      {
        _id: suspendedAgencyId,
        name: 'Fixture Suspended',
        slug: 'fixture-away-suspended',
        status: 'suspended',
        timezone: 'America/Chicago',
      },
    ]);
  });

  it('does nothing before 8 PM in the agency timezone', async () => {
    const available = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'early-available',
      availability: 'available',
    });
    const busy = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'early-busy',
      availability: 'busy',
    });

    await fn.handle(inlineStep(), CHICAGO_1959);

    expect(await availabilityOf(available)).toBe('available');
    expect(await availabilityOf(busy)).toBe('busy');
    expect(await markerOf(chicagoAgencyId)).toBeUndefined();
  });

  it('sets every active user of the agency Away at 8 PM local, and only them', async () => {
    const available = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'available',
      availability: 'available',
    });
    const busy = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'busy',
      availability: 'busy',
    });
    const alreadyAway = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'already-away',
      availability: 'away',
    });
    const deactivated = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'deactivated',
      availability: 'available',
      isActive: false,
    });
    const platformAdmin = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'platform-admin',
      availability: 'available',
      isPlatformAdmin: true,
    });
    // Same instant is 06:30 in Kolkata — not their evening.
    const elsewhere = await seedUser({
      agencyId: kolkataAgencyId,
      handle: 'kolkata-morning',
      availability: 'available',
    });

    const result = await fn.handle(inlineStep(), CHICAGO_2000);

    // At least the two fixture users; the shared database may add more.
    expect(result.flipped).toBeGreaterThanOrEqual(2);
    expect(result.agenciesFlipped).toBeGreaterThanOrEqual(1);
    expect(await availabilityOf(available)).toBe('away');
    expect(await availabilityOf(busy)).toBe('away');
    expect(await availabilityOf(alreadyAway)).toBe('away');
    expect(await availabilityOf(deactivated)).toBe('available');
    expect(await availabilityOf(platformAdmin)).toBe('available');
    expect(await availabilityOf(elsewhere)).toBe('available');

    const marker = await markerOf(chicagoAgencyId);
    expect(marker?.lastAwayDate).toBe('2025-09-25');
    expect(marker?.lastAwayAt).toEqual(CHICAGO_2000);
    expect(await markerOf(kolkataAgencyId)).toBeUndefined();
  });

  it('keys each agency off its own zone, half-hour offsets included', async () => {
    const kolkata = await seedUser({
      agencyId: kolkataAgencyId,
      handle: 'kolkata-evening',
      availability: 'available',
    });
    const chicago = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'chicago-morning',
      availability: 'available',
    });

    await fn.handle(inlineStep(), KOLKATA_2000);

    expect(await availabilityOf(kolkata)).toBe('away');
    expect(await availabilityOf(chicago)).toBe('available');
    expect((await markerOf(kolkataAgencyId))?.lastAwayDate).toBe('2025-09-25');
    expect(await markerOf(chicagoAgencyId)).toBeUndefined();
  });

  it('runs once per local date, so a user who comes back stays back', async () => {
    const user = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'returns',
      availability: 'available',
    });

    await fn.handle(inlineStep(), CHICAGO_2000);
    expect(await availabilityOf(user)).toBe('away');

    // Comes back at 20:15 for the evening.
    await users.collection.updateOne(
      { _id: user },
      { $set: { availability: 'available' } },
    );

    await fn.handle(inlineStep(), CHICAGO_2030);
    expect(await availabilityOf(user)).toBe('available');
    expect((await markerOf(chicagoAgencyId))?.lastAwayDate).toBe('2025-09-25');

    // The next evening is a new local date.
    await fn.handle(inlineStep(), CHICAGO_NEXT_2000);
    expect(await availabilityOf(user)).toBe('away');
    expect((await markerOf(chicagoAgencyId))?.lastAwayDate).toBe('2025-09-26');
  });

  it('catches up a tick the worker missed, later the same evening', async () => {
    const user = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'missed-tick',
      availability: 'available',
    });

    await fn.handle(inlineStep(), CHICAGO_2330);

    expect(await availabilityOf(user)).toBe('away');
    expect((await markerOf(chicagoAgencyId))?.lastAwayDate).toBe('2025-09-25');
  });

  it('falls back to Central time for an agency that predates the timezone field', async () => {
    const user = await seedUser({
      agencyId: legacyAgencyId,
      handle: 'legacy',
      availability: 'busy',
    });

    await fn.handle(inlineStep(), CHICAGO_1959);
    expect(await availabilityOf(user)).toBe('busy');

    await fn.handle(inlineStep(), CHICAGO_2000);
    expect(await availabilityOf(user)).toBe('away');
    expect((await markerOf(legacyAgencyId))?.lastAwayDate).toBe('2025-09-25');
  });

  it('leaves a suspended agency alone', async () => {
    const user = await seedUser({
      agencyId: suspendedAgencyId,
      handle: 'suspended',
      availability: 'available',
    });

    await fn.handle(inlineStep(), CHICAGO_2000);

    expect(await availabilityOf(user)).toBe('available');
    expect(await markerOf(suspendedAgencyId)).toBeUndefined();
  });

  it('does not flip when another caller has already claimed tonight', async () => {
    const user = await seedUser({
      agencyId: chicagoAgencyId,
      handle: 'claimed',
      availability: 'available',
    });
    // A replica got there first: the marker says tonight is done.
    await agencies.collection.updateOne(
      { _id: chicagoAgencyId },
      { $set: { availabilitySweep: { lastAwayDate: '2025-09-25' } } },
    );

    await fn.handle(inlineStep(), CHICAGO_2000);

    expect(await availabilityOf(user)).toBe('available');
  });
});
