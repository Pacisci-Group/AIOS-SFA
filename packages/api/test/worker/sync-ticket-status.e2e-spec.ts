import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { WorkerModule } from '../../src/worker/worker.module';
import { SyncTicketStatusFn } from '../../src/worker/functions/sync-ticket-status.fn';
import { MailTransport } from '../../src/worker/email/mail-transport';
import {
  ServiceTicket,
  type ServiceTicketDocument,
} from '../../src/crm/schemas/service-ticket.schema';
import { Agency } from '../../src/platform/schemas/agency.schema';

/**
 * `SyncTicketStatusFn` against a real MongoDB.
 *
 * Deliberately not a unit test with a fake matcher. What these predicates do
 * depends on **Mongo's own matching semantics** — type-bracketed range
 * operators, how `$ne: null` treats a missing field, how `$or` composes with
 * them — and a JavaScript reimplementation of that would happily agree with a
 * wrong query. Only the database can answer it. (Writing this suite is what
 * showed the inherited claim about null and `$lt` to be false; see the
 * docblock on `step-status.query.ts`.)
 *
 * The failure being guarded against is silent in every direction: statuses
 * that do not advance leave the queue quietly stale (which is PAC-102, the bug
 * this job exists to end), and statuses that advance when they should not
 * overwrite a CSR's own decision. Neither throws.
 */

/** Runs each step inline — same seam as `sweep-event-log.e2e-spec.ts`. */
function inlineStep() {
  return {
    run: <T>(_id: string, fn: () => Promise<T> | T): Promise<T> =>
      Promise.resolve(fn()),
  };
}

const HOUR_MS = 60 * 60 * 1000;

describe('SyncTicketStatusFn (e2e)', () => {
  let app: INestApplication;
  let fn: SyncTicketStatusFn;
  let tickets: Model<ServiceTicketDocument>;
  let agencies: Model<Agency>;

  const agencyId = new Types.ObjectId();
  const otherAgencyId = new Types.ObjectId();
  const inactiveAgencyId = new Types.ObjectId();

  const past = new Date(Date.now() - 2 * HOUR_MS);
  const future = new Date(Date.now() + 2 * HOUR_MS);

  /**
   * Insert a ticket directly through the driver, bypassing Mongoose.
   *
   * `insertOne` on the collection skips the `pre('save')` hook on purpose:
   * these fixtures stand in for rows that already exist in the database, which
   * is precisely the population the sweep has to correct. Going through the
   * model would have the hook pre-fix them and the test would prove nothing.
   */
  async function seedTicket(opts: {
    agencyId?: Types.ObjectId;
    step: 'onboarding' | 'renewal';
    status: string;
    statusOverriddenAt?: Date | null;
    availableAt: Date | null;
    dueAt: Date | null;
    completedAt?: Date | null;
    ticketNumber: string;
  }): Promise<Types.ObjectId> {
    const id = new Types.ObjectId();
    await tickets.collection.insertOne({
      _id: id,
      agencyId: opts.agencyId ?? agencyId,
      branchId: null,
      ticketNumber: opts.ticketNumber,
      clientName: 'Fixture Client',
      category: opts.step === 'onboarding' ? 'Onboarding' : 'Renewal Review',
      status: opts.status,
      statusOverriddenAt: opts.statusOverriddenAt ?? null,
      priority: 'medium',
      urgencyRank: 1,
      priorityRank: 1,
      urgencyAt: past,
      assignedRep: '',
      assignedUserId: null,
      openedAt: past,
      lastActivityAt: past,
      resolvedAt: null,
      timeline: [],
      [opts.step]: {
        availableAt: opts.availableAt,
        dueAt: opts.dueAt,
        completedAt: opts.completedAt ?? null,
      },
    });
    return id;
  }

  const statusOf = async (id: Types.ObjectId) =>
    (await tickets.collection.findOne({ _id: id })) as {
      status: string;
      urgencyRank: number;
    } | null;

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

    fn = app.get(SyncTicketStatusFn);
    tickets = app.get<Model<ServiceTicketDocument>>(
      getModelToken(ServiceTicket.name),
    );
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
  });

  afterAll(async () => {
    await tickets.collection.deleteMany({
      agencyId: { $in: [agencyId, otherAgencyId, inactiveAgencyId] },
    });
    await agencies.collection.deleteMany({
      _id: { $in: [agencyId, otherAgencyId, inactiveAgencyId] },
    });
    await app.close();
  });

  beforeEach(async () => {
    await tickets.collection.deleteMany({
      agencyId: { $in: [agencyId, otherAgencyId, inactiveAgencyId] },
    });
    await agencies.collection.deleteMany({
      _id: { $in: [agencyId, otherAgencyId, inactiveAgencyId] },
    });
    await agencies.collection.insertMany([
      { _id: agencyId, name: 'Fixture A', slug: 'fixture-a', status: 'active' },
      {
        _id: otherAgencyId,
        name: 'Fixture B',
        slug: 'fixture-b',
        status: 'active',
      },
      {
        _id: inactiveAgencyId,
        name: 'Fixture C',
        slug: 'fixture-c',
        status: 'suspended',
      },
    ]);
  });

  describe.each(['onboarding', 'renewal'] as const)('%s steps', (step) => {
    it('advances a past-due call to overdue and ranks it first', async () => {
      const id = await seedTicket({
        step,
        status: 'open',
        availableAt: past,
        dueAt: past,
        ticketNumber: `T-${step}-1`,
      });

      await fn.handle(inlineStep());

      const after = await statusOf(id);
      expect(after?.status).toBe('overdue');
      // The rank must move with the status, or the queue sorts by a value that
      // disagrees with the badge it renders.
      expect(after?.urgencyRank).toBe(0);
    });

    it('opens a call that has become available', async () => {
      const id = await seedTicket({
        step,
        status: 'waiting',
        availableAt: past,
        dueAt: future,
        ticketNumber: `T-${step}-2`,
      });

      await fn.handle(inlineStep());

      const after = await statusOf(id);
      expect(after?.status).toBe('open');
      expect(after?.urgencyRank).toBe(1);
    });

    it('leaves a call that has not opened yet', async () => {
      const id = await seedTicket({
        step,
        status: 'waiting',
        availableAt: future,
        dueAt: future,
        ticketNumber: `T-${step}-3`,
      });

      await fn.handle(inlineStep());

      expect((await statusOf(id))?.status).toBe('waiting');
    });

    it('leaves a completed call alone', async () => {
      const id = await seedTicket({
        step,
        status: 'resolved',
        availableAt: past,
        dueAt: past,
        completedAt: past,
        ticketNumber: `T-${step}-4`,
      });

      await fn.handle(inlineStep());

      expect((await statusOf(id))?.status).toBe('resolved');
    });

    /** An explicit human decision outranks the schedule. */
    it('never overwrites a status a CSR set by hand', async () => {
      const id = await seedTicket({
        step,
        status: 'waiting_on_client',
        statusOverriddenAt: past,
        availableAt: past,
        dueAt: past,
        ticketNumber: `T-${step}-5`,
      });

      await fn.handle(inlineStep());

      expect((await statusOf(id))?.status).toBe('waiting_on_client');
    });

    /**
     * A step carrying no dates is not scheduled and must never be swept.
     *
     * Type bracketing means the range clauses already exclude it, so this
     * passes with or without the `$ne: null` guards — it pins the *behaviour*,
     * not those guards. Kept because the behaviour is what matters: whatever
     * shape these predicates take later, an unscheduled step stays untouched.
     */
    it('ignores a step carrying no dates', async () => {
      const id = await seedTicket({
        step,
        status: 'open',
        availableAt: null,
        dueAt: null,
        ticketNumber: `T-${step}-6`,
      });

      await fn.handle(inlineStep());

      expect((await statusOf(id))?.status).toBe('open');
    });
  });

  it('sweeps every active agency, and skips suspended ones', async () => {
    const mine = await seedTicket({
      step: 'renewal',
      status: 'open',
      availableAt: past,
      dueAt: past,
      ticketNumber: 'T-multi-1',
    });
    const theirs = await seedTicket({
      agencyId: otherAgencyId,
      step: 'renewal',
      status: 'open',
      availableAt: past,
      dueAt: past,
      ticketNumber: 'T-multi-2',
    });
    const suspended = await seedTicket({
      agencyId: inactiveAgencyId,
      step: 'renewal',
      status: 'open',
      availableAt: past,
      dueAt: past,
      ticketNumber: 'T-multi-3',
    });

    const result = await fn.handle(inlineStep());

    expect((await statusOf(mine))?.status).toBe('overdue');
    expect((await statusOf(theirs))?.status).toBe('overdue');
    expect((await statusOf(suspended))?.status).toBe('open');
    expect(result.transitions).toBe(2);
  });

  /**
   * The count is the only signal anyone has that this job is working, so it
   * has to mean "transitions", not "rows rewritten to the value they held".
   */
  it('is idempotent — a second run transitions nothing', async () => {
    await seedTicket({
      step: 'renewal',
      status: 'open',
      availableAt: past,
      dueAt: past,
      ticketNumber: 'T-idem-1',
    });

    const first = await fn.handle(inlineStep());
    const second = await fn.handle(inlineStep());

    expect(first.transitions).toBe(1);
    expect(second.transitions).toBe(0);
  });
});
