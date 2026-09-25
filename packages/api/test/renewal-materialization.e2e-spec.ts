import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccessScope, DataScope, type AccessContext } from '@sfa/shared';
import { createTestApp } from './helpers/test-app';
import { ServiceTicketsService } from '../src/crm/service-tickets.service';
import { RenewalCycle } from '../src/crm/schemas/renewal-cycle.schema';
import { RenewalScanState } from '../src/crm/schemas/renewal-scan-state.schema';
import { ServiceTicket } from '../src/crm/schemas/service-ticket.schema';
import { Household } from '../src/households/schemas/household.schema';
import { Policy } from '../src/policies/schemas/policy.schema';

/**
 * Characterization tests for renewal materialization.
 *
 * ## Why these exist
 *
 * Renewal cycles are built by ~450 lines spread across `ServiceTicketsService`
 * — `materializeRenewalCycles` → `ensureRenewalCycle` → `reconcileRenewalCycle`
 * → `ensureRenewalTicket` — and PAC-99 lifts that whole subtree out of the
 * service so a worker cron can run it. Before this suite the only coverage was
 * unit tests over the pure scheduling helpers: the orchestration, the cycle
 * writes and the ticket creation had **none**, and a move that quietly changed
 * any of them would have shipped.
 *
 * So these were written against the code *before* the extraction and must pass
 * unchanged after it. They assert observable behaviour — what ends up in
 * `renewalCycles` and `serviceTickets` — and deliberately not how it gets
 * there, which is the part that moves.
 *
 * ## Scope
 *
 * Deliberately not exhaustive over renewal *scheduling* (`renewal-scheduling.unit-spec.ts`
 * owns the step maths). This covers the parts the refactor threatens: does a
 * policy in the horizon produce a cycle, does that cycle produce its call
 * tickets, is the CSR assignment carried across, is a second pass idempotent,
 * and does the throttle hold.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Renewal materialization (e2e)', () => {
  let app: INestApplication;
  let tickets: ServiceTicketsService;
  let cycles: Model<RenewalCycle>;
  let scanState: Model<RenewalScanState>;
  let ticketModel: Model<ServiceTicket>;
  let households: Model<Household>;
  let policies: Model<Policy>;

  const agencyId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const csrId = new Types.ObjectId();

  const access: AccessContext = {
    userId: csrId.toHexString(),
    agencyId: agencyId.toHexString(),
    branchId: branchId.toHexString(),
    isPlatformAdmin: false,
    scope: AccessScope.Agency,
    dataScope: DataScope.Agency,
    permissions: ['crm_service:read', 'crm_service:write'],
    roleIds: [],
  };

  /** A household with one auto policy renewing `inDays` from now. */
  async function seedBook(inDays: number, policyNumber: string) {
    const renewalDate = new Date(Date.now() + inDays * DAY_MS);
    const household = await households.create({
      agencyId,
      branchId,
      name: 'Renewal Fixture Household',
      assignedCrmId: csrId,
      isTestRecord: true,
    } as unknown as Household);

    await policies.create({
      agencyId,
      branchId,
      legacySmartSuiteId: `renewal-e2e:${policyNumber}`,
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

    return { household, renewalDate };
  }

  /** The throttle is per agency and persists; clear it so a scan runs now. */
  const clearThrottle = () => scanState.deleteMany({ agencyId });

  const wipe = async () => {
    await Promise.all([
      cycles.deleteMany({ agencyId }),
      ticketModel.deleteMany({ agencyId }),
      households.deleteMany({ agencyId }),
      policies.deleteMany({ agencyId }),
      scanState.deleteMany({ agencyId }),
    ]);
  };

  beforeAll(async () => {
    app = await createTestApp();
    tickets = app.get(ServiceTicketsService);
    cycles = app.get<Model<RenewalCycle>>(getModelToken(RenewalCycle.name));
    scanState = app.get<Model<RenewalScanState>>(
      getModelToken(RenewalScanState.name),
    );
    ticketModel = app.get<Model<ServiceTicket>>(
      getModelToken(ServiceTicket.name),
    );
    households = app.get<Model<Household>>(getModelToken(Household.name));
    policies = app.get<Model<Policy>>(getModelToken(Policy.name));
  });

  afterAll(async () => {
    await wipe();
    await app.close();
  });

  beforeEach(wipe);

  it('creates a cycle for a policy inside the horizon', async () => {
    const { renewalDate } = await seedBook(60, 'RN-E2E-1');

    await tickets.materializeRenewalCycles(access);

    const built = await cycles.find({ agencyId }).lean();
    expect(built).toHaveLength(1);
    expect(built[0].policies).toHaveLength(1);
    expect(built[0].policies[0].policyNumber).toBe('RN-E2E-1');
    // Same day, whatever the clock time the fixture was built at.
    expect(new Date(built[0].renewalDate).toDateString()).toBe(
      renewalDate.toDateString(),
    );
    expect(built[0].completedAt).toBeNull();
  });

  it('opens call tickets for the cycle it creates', async () => {
    await seedBook(60, 'RN-E2E-2');

    await tickets.materializeRenewalCycles(access);

    const built = await ticketModel
      .find({ agencyId, category: 'Renewal Review' })
      .lean();
    expect(built.length).toBeGreaterThan(0);
    for (const ticket of built) {
      expect(ticket.renewal).toBeTruthy();
      expect(String(ticket.renewal!.renewalCycleId)).toBe(
        String((await cycles.findOne({ agencyId }).lean())!._id),
      );
      // The number is allocated, not left blank — `createTicketWithNumber`
      // moves in this refactor and a silently empty number would still render.
      expect(ticket.ticketNumber).toMatch(/^RENEW-\d+$/);
    }
  });

  /**
   * A `csr` is `own`-scoped, so a call assigned to nobody is invisible to the
   * person meant to make it. The assignment comes off the household and is the
   * kind of field a refactor drops without any test noticing.
   */
  it("carries the household's CSR onto the cycle", async () => {
    await seedBook(60, 'RN-E2E-3');

    await tickets.materializeRenewalCycles(access);

    const built = await cycles.findOne({ agencyId }).lean();
    expect(String(built!.assignedCsrId)).toBe(csrId.toHexString());
  });

  it('is idempotent — a second pass adds no cycle and no ticket', async () => {
    await seedBook(60, 'RN-E2E-4');

    await tickets.materializeRenewalCycles(access);
    const afterFirst = {
      cycles: await cycles.countDocuments({ agencyId }),
      tickets: await ticketModel.countDocuments({ agencyId }),
    };

    await clearThrottle();
    await tickets.materializeRenewalCycles(access);

    expect(await cycles.countDocuments({ agencyId })).toBe(afterFirst.cycles);
    expect(await ticketModel.countDocuments({ agencyId })).toBe(
      afterFirst.tickets,
    );
  });

  /**
   * The throttle is the whole reason reading the desk is survivable today, and
   * it is also the lock the worker cron will rely on. If the extraction drops
   * it, nothing fails — the scan just runs on every single request.
   */
  it('does not rescan while the throttle window is held', async () => {
    await seedBook(60, 'RN-E2E-5');
    await tickets.materializeRenewalCycles(access);

    // No `clearThrottle()`: the window claimed above is still open.
    await seedBook(70, 'RN-E2E-6');
    await tickets.materializeRenewalCycles(access);

    expect(await cycles.countDocuments({ agencyId })).toBe(1);
  });

  it('ignores a policy far outside the horizon', async () => {
    await seedBook(300, 'RN-E2E-7');

    await tickets.materializeRenewalCycles(access);

    expect(await cycles.countDocuments({ agencyId })).toBe(0);
  });

  it('closes a cycle whose policies are no longer active', async () => {
    await seedBook(60, 'RN-E2E-8');
    await tickets.materializeRenewalCycles(access);
    expect(await cycles.countDocuments({ agencyId })).toBe(1);

    await policies.updateMany({ agencyId }, { $set: { active: false } });
    await clearThrottle();
    await tickets.materializeRenewalCycles(access);

    const built = await cycles.findOne({ agencyId }).lean();
    expect(built!.completedAt).not.toBeNull();
    expect(built!.closedReason).toBe('policy_ineligible');
  });
});
