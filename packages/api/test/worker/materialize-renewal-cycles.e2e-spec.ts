import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { INestApplication } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ENV_FILE_PATH } from '../../src/config/env.config';
import { InngestModule } from '../../src/inngest/inngest.module';
import { WorkerModule } from '../../src/worker/worker.module';
import { MaterializeRenewalCyclesFn } from '../../src/worker/functions/materialize-renewal-cycles.fn';
import { MailTransport } from '../../src/worker/email/mail-transport';
import { RenewalCycle } from '../../src/crm/schemas/renewal-cycle.schema';
import { RenewalScanState } from '../../src/crm/schemas/renewal-scan-state.schema';
import { ServiceTicket } from '../../src/crm/schemas/service-ticket.schema';
import { Household } from '../../src/households/schemas/household.schema';
import { Policy } from '../../src/policies/schemas/policy.schema';
import { Agency } from '../../src/platform/schemas/agency.schema';
import { RenewalMaterializationService } from '../../src/common/renewal/renewal-materialization.service';

/**
 * The renewal scan, driven by the cron rather than by a CSR's page load.
 *
 * This is the half of PAC-99 that could not be tested before the extraction:
 * that the materializer runs **from the worker**, with no request and no
 * `AccessContext`, across every tenant. `renewal-materialization.e2e-spec.ts`
 * covers what it builds; this covers that the worker can build it at all.
 *
 * Booting `WorkerModule` on its own is the real assertion here. The worker's
 * import boundary means a dependency reached for through a feature service
 * would resolve fine under `AppModule` and fail only in the standalone worker
 * — a failure that would not appear until the container it was extracted into
 * came up in production.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs each step inline — same seam as `sweep-event-log.e2e-spec.ts`. */
const inlineStep = {
  run: <T,>(_id: string, fn: () => Promise<T> | T): Promise<unknown> =>
    Promise.resolve(fn()),
};

describe('MaterializeRenewalCyclesFn (e2e)', () => {
  let app: INestApplication;
  let fn: MaterializeRenewalCyclesFn;
  let cycles: Model<RenewalCycle>;
  let scanState: Model<RenewalScanState>;
  let tickets: Model<ServiceTicket>;
  let households: Model<Household>;
  let policies: Model<Policy>;
  let agencies: Model<Agency>;

  const agencyA = new Types.ObjectId();
  const agencyB = new Types.ObjectId();
  const suspended = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const all = [agencyA, agencyB, suspended];

  async function seedBook(agencyId: Types.ObjectId, policyNumber: string) {
    const renewalDate = new Date(Date.now() + 60 * DAY_MS);
    const household = await households.create({
      agencyId,
      branchId,
      name: `Book of ${policyNumber}`,
      isTestRecord: true,
    } as unknown as Household);

    await policies.create({
      agencyId,
      branchId,
      legacySmartSuiteId: `renewal-cron:${policyNumber}`,
      policyNumber,
      policyType: 'Auto',
      carrier: 'Pacific Standard',
      active: true,
      policyStatus: 'Active',
      premium: 1200,
      items: 1,
      effectiveDate: new Date(renewalDate.getTime() - 365 * DAY_MS),
      expirationDate: renewalDate,
      renewalDate,
      householdId: household._id,
      isTestRecord: true,
    } as unknown as Policy);
  }

  const wipe = async () => {
    const scope = { agencyId: { $in: all } };
    await Promise.all([
      cycles.deleteMany(scope),
      tickets.deleteMany(scope),
      households.deleteMany(scope),
      policies.deleteMany(scope),
      scanState.deleteMany(scope),
      agencies.deleteMany({ _id: { $in: all } }),
    ]);
  };

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

    fn = app.get(MaterializeRenewalCyclesFn);
    cycles = app.get<Model<RenewalCycle>>(getModelToken(RenewalCycle.name));
    scanState = app.get<Model<RenewalScanState>>(
      getModelToken(RenewalScanState.name),
    );
    tickets = app.get<Model<ServiceTicket>>(getModelToken(ServiceTicket.name));
    households = app.get<Model<Household>>(getModelToken(Household.name));
    policies = app.get<Model<Policy>>(getModelToken(Policy.name));
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  beforeEach(async () => {
    await wipe();
    await agencies.collection.insertMany([
      { _id: agencyA, name: 'A', slug: 'cron-a', status: 'active' },
      { _id: agencyB, name: 'B', slug: 'cron-b', status: 'active' },
      { _id: suspended, name: 'C', slug: 'cron-c', status: 'suspended' },
    ] as unknown as Agency[]);
  });

  it('materializes cycles for every active agency, with no request context', async () => {
    await seedBook(agencyA, 'CRON-A1');
    await seedBook(agencyB, 'CRON-B1');

    const result = await fn.handle(inlineStep);

    expect(await cycles.countDocuments({ agencyId: agencyA })).toBe(1);
    expect(await cycles.countDocuments({ agencyId: agencyB })).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('opens the call tickets, not just the cycles', async () => {
    await seedBook(agencyA, 'CRON-A2');

    await fn.handle(inlineStep);

    const opened = await tickets.countDocuments({
      agencyId: agencyA,
      category: 'Renewal Review',
    });
    expect(opened).toBeGreaterThan(0);
  });

  it('skips suspended agencies', async () => {
    await seedBook(suspended, 'CRON-C1');

    await fn.handle(inlineStep);

    expect(await cycles.countDocuments({ agencyId: suspended })).toBe(0);
  });

  /**
   * The per-agency throttle is the lock that used to stop two requests
   * double-scanning and now stops two worker replicas doing the same. A tick
   * that finds the window held must be a no-op, not a second scan.
   */
  it('respects the per-agency scan throttle across ticks', async () => {
    await seedBook(agencyA, 'CRON-A3');
    await fn.handle(inlineStep);

    await seedBook(agencyA, 'CRON-A4');
    await fn.handle(inlineStep);

    // The second book never got scanned, so it produced no second cycle.
    expect(await cycles.countDocuments({ agencyId: agencyA })).toBe(1);
  });

  /**
   * One tenant's bad data must not stop the sweep: every agency after it in
   * the loop would silently stop being scanned, and the symptom — some
   * agencies' desks quietly going stale — looks nothing like the cause.
   */
  it('keeps sweeping when one agency throws', async () => {
    await seedBook(agencyA, 'CRON-A5');
    await seedBook(agencyB, 'CRON-B5');

    const renewals = app.get(RenewalMaterializationService);
    const real = renewals.materializeForAgency.bind(renewals);
    jest
      .spyOn(renewals, 'materializeForAgency')
      .mockImplementation(async (id: Types.ObjectId) => {
        if (String(id) === String(agencyA)) throw new Error('boom');
        return real(id);
      });

    const result = await fn.handle(inlineStep);

    expect(result.failed).toBe(1);
    // B was after A in the loop and still got its cycle.
    expect(await cycles.countDocuments({ agencyId: agencyB })).toBe(1);
    jest.restoreAllMocks();
  });
});
