import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { InngestService } from '../../src/inngest/inngest.service';
import { WorkerModule } from '../../src/worker/worker.module';
import { ProposeNextYearHolidaysFn } from '../../src/worker/functions/propose-next-year-holidays.fn';
import { MailTransport } from '../../src/worker/email/mail-transport';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { AgencyCalendar } from '../../src/hr/schemas/agency-calendar.schema';
import { User } from '../../src/users/schemas/user.schema';
import { CapturedInngestService } from '../helpers/test-app';

/**
 * `ProposeNextYearHolidaysFn` against a real MongoDB (PAC-161).
 *
 * The suggestions themselves are unit-tested in `holiday-suggestions`. What
 * only the database can answer: that the claim on `proposals.year` is
 * conditional, that only the `agency:hr:admin` holders are notified, that an
 * agency outside Q4 on its own clock, with no country, or already holding a
 * proposal for the year is skipped, and that a suspended tenant is not swept.
 *
 * Same discipline as `set-users-away.e2e-spec.ts`: the sweep is not scoped,
 * so every assertion is on the fixture rows, and the clock is pinned to a
 * year no real tick will ever propose for again.
 */

function inlineStep() {
  return {
    run: <T>(_id: string, fn: () => Promise<T> | T): Promise<T> =>
      Promise.resolve(fn()),
  };
}

const FIXTURE_DOMAIN = 'holidays-fixture.local';
// 2025-10-01 03:00Z is still 30 September in Chicago, and 1 October in Kolkata.
const SEPT_30_CHICAGO = new Date('2025-10-01T03:00:00Z');
const OCT_1_CHICAGO = new Date('2025-10-01T12:00:00Z');

describe('ProposeNextYearHolidaysFn (e2e)', () => {
  let app: INestApplication;
  let fn: ProposeNextYearHolidaysFn;
  let inngest: CapturedInngestService;
  let agencies: Model<Agency>;
  let calendars: Model<AgencyCalendar>;
  let users: Model<User>;

  const chicagoId = new Types.ObjectId();
  const kolkataId = new Types.ObjectId();
  const noCountryId = new Types.ObjectId();
  const alreadyId = new Types.ObjectId();
  const suspendedId = new Types.ObjectId();
  const allIds = [chicagoId, kolkataId, noCountryId, alreadyId, suspendedId];

  const adminId = new Types.ObjectId();
  const producerId = new Types.ObjectId();
  const inactiveAdminId = new Types.ObjectId();
  const kolkataAdminId = new Types.ObjectId();

  async function reset() {
    const db = agencies.db;
    await users.collection.deleteMany({
      email: { $regex: `@${FIXTURE_DOMAIN.replace('.', '\\.')}$` },
    });
    await agencies.collection.deleteMany({ _id: { $in: allIds } });
    await calendars.collection.deleteMany({
      agencyId: { $in: allIds.map((id) => id.toHexString()) },
    });
    await db.collection('roles').deleteMany({ agencyId: { $in: allIds } });
    await db
      .collection('rolePermissions')
      .deleteMany({ agencyId: { $in: allIds } });
    await db.collection('userRoles').deleteMany({ agencyId: { $in: allIds } });
    inngest.sent.length = 0;
  }

  /** An agency, its calendar, and a Branch Manager-shaped role holding the admin key. */
  async function seedAgency(opts: {
    id: Types.ObjectId;
    slug: string;
    timezone: string;
    status?: 'active' | 'suspended';
    country?: string | null;
    region?: string | null;
    proposals?: { year: number }[];
    admins?: { id: Types.ObjectId; handle: string; isActive?: boolean }[];
    others?: { id: Types.ObjectId; handle: string }[];
  }) {
    const db = agencies.db;
    await agencies.collection.insertOne({
      _id: opts.id,
      name: `Fixture ${opts.slug}`,
      slug: `fixture-holidays-${opts.slug}`,
      status: opts.status ?? 'active',
      timezone: opts.timezone,
      modules: { hr: { enabled: true } },
    });
    await calendars.collection.insertOne({
      agencyId: opts.id.toHexString(),
      workweek: [1, 2, 3, 4, 5],
      country: opts.country === undefined ? 'US' : opts.country,
      region: opts.region ?? null,
      proposals: (opts.proposals ?? []).map((p) => ({
        ...p,
        status: 'pending',
        proposedAt: new Date(),
        items: [],
        decidedAt: null,
        decidedBy: null,
      })),
    });
    const roleId = new Types.ObjectId();
    await db.collection('roles').insertOne({
      _id: roleId,
      agencyId: opts.id,
      name: 'Branch Manager',
      slug: 'branch_manager',
      dataScope: 'branch',
      isSystemTemplate: true,
      grantsAllEnabledModules: false,
    });
    await db.collection('rolePermissions').insertOne({
      agencyId: opts.id,
      roleId,
      permissionId: new Types.ObjectId(),
      permissionKey: 'agency:hr:admin',
      source: 'template',
    });
    for (const admin of opts.admins ?? []) {
      await users.collection.insertOne({
        _id: admin.id,
        email: `${admin.handle}@${FIXTURE_DOMAIN}`,
        passwordHash: 'fixture',
        firstName: admin.handle,
        lastName: 'Fixture',
        agencyId: opts.id,
        branchId: null,
        isActive: admin.isActive ?? true,
        isPlatformAdmin: false,
      });
      await db.collection('userRoles').insertOne({
        agencyId: opts.id,
        userId: admin.id,
        roleId,
      });
    }
    for (const other of opts.others ?? []) {
      await users.collection.insertOne({
        _id: other.id,
        email: `${other.handle}@${FIXTURE_DOMAIN}`,
        passwordHash: 'fixture',
        firstName: other.handle,
        lastName: 'Fixture',
        agencyId: opts.id,
        branchId: null,
        isActive: true,
        isPlatformAdmin: false,
      });
    }
  }

  const proposalsOf = async (id: Types.ObjectId) =>
    (
      (await calendars.collection.findOne({ agencyId: id.toHexString() })) as {
        proposals: {
          year: number;
          status: string;
          items: { date: string }[];
        }[];
      } | null
    )?.proposals ?? [];

  beforeAll(async () => {
    inngest = new CapturedInngestService();
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
      .overrideProvider(InngestService)
      .useValue(inngest)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    fn = app.get(ProposeNextYearHolidaysFn);
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
    calendars = app.get<Model<AgencyCalendar>>(
      getModelToken(AgencyCalendar.name),
    );
    users = app.get<Model<User>>(getModelToken(User.name));
  });

  afterAll(async () => {
    await reset();
    await app.close();
  });

  beforeEach(async () => {
    await reset();
    await seedAgency({
      id: chicagoId,
      slug: 'chicago',
      timezone: 'America/Chicago',
      region: 'OK',
      admins: [
        { id: adminId, handle: 'admin' },
        { id: inactiveAdminId, handle: 'gone', isActive: false },
      ],
      others: [{ id: producerId, handle: 'producer' }],
    });
    await seedAgency({
      id: kolkataId,
      slug: 'kolkata',
      timezone: 'Asia/Kolkata',
      country: 'IN',
      admins: [{ id: kolkataAdminId, handle: 'kolkata-admin' }],
    });
    await seedAgency({
      id: noCountryId,
      slug: 'nowhere',
      timezone: 'America/Chicago',
      country: null,
    });
    await seedAgency({
      id: alreadyId,
      slug: 'already',
      timezone: 'America/Chicago',
      proposals: [{ year: 2026 }],
    });
    await seedAgency({
      id: suspendedId,
      slug: 'suspended',
      timezone: 'America/Chicago',
      status: 'suspended',
    });
  });

  it('proposes nothing while it is still September on the agency clock', async () => {
    await fn.handle(inlineStep(), SEPT_30_CHICAGO);
    expect(await proposalsOf(chicagoId)).toEqual([]);
    // …but Kolkata is already in October, and gets its own country's holidays.
    const [proposal] = await proposalsOf(kolkataId);
    expect(proposal).toMatchObject({ year: 2026, status: 'pending' });
    expect(proposal.items.length).toBeGreaterThan(0);
  });

  it('proposes once on the first October tick, and notifies the active admins only', async () => {
    const result = await fn.handle(inlineStep(), OCT_1_CHICAGO);
    expect(result.proposed).toBeGreaterThanOrEqual(2);

    const [proposal] = await proposalsOf(chicagoId);
    expect(proposal).toMatchObject({ year: 2026, status: 'pending' });
    expect(proposal.items.some((item) => item.date === '2026-11-26')).toBe(
      true,
    );

    const sent = inngest.sent.filter(
      (event) =>
        event.name === 'notification/requested.v1' &&
        (event.data.agencyId as string) === chicagoId.toHexString(),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].data).toMatchObject({
      type: 'hr.holidays_proposed',
      recipientIds: [adminId.toHexString()],
      dedupeKey: `hr.holidays_proposed:${chicagoId.toHexString()}:2026`,
      data: {
        year: 2026,
        countryName: 'United States of America',
        regionName: 'Oklahoma',
      },
    });
  });

  it('is idempotent: a second tick writes and sends nothing more', async () => {
    await fn.handle(inlineStep(), OCT_1_CHICAGO);
    const sentBefore = inngest.sent.length;
    const second = await fn.handle(inlineStep(), OCT_1_CHICAGO);
    expect(second.proposed).toBe(0);
    expect(inngest.sent).toHaveLength(sentBefore);
    expect(await proposalsOf(chicagoId)).toHaveLength(1);
  });

  it('skips an agency with no country, one that already has the year, and a suspended one', async () => {
    await fn.handle(inlineStep(), OCT_1_CHICAGO);
    expect(await proposalsOf(noCountryId)).toEqual([]);
    expect(await proposalsOf(alreadyId)).toHaveLength(1);
    expect(await proposalsOf(suspendedId)).toEqual([]);
    const agencyIds = inngest.sent.map(
      (event) => event.data.agencyId as string,
    );
    expect(agencyIds).not.toContain(noCountryId.toHexString());
    expect(agencyIds).not.toContain(alreadyId.toHexString());
    expect(agencyIds).not.toContain(suspendedId.toHexString());
  });
});
