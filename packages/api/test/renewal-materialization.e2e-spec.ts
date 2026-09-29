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

  /**
   * A household with one policy renewing `inDays` from now — Auto (the
   * semiannual track, one merged call at T-45) unless told otherwise.
   */
  async function seedBook(
    inDays: number,
    policyNumber: string,
    policyType = 'Auto',
    assignedCrmId: Types.ObjectId = csrId,
  ) {
    const renewalDate = new Date(Date.now() + inDays * DAY_MS);
    const household = await households.create({
      agencyId,
      branchId,
      name: 'Renewal Fixture Household',
      assignedCrmId,
      isTestRecord: true,
    } as unknown as Household);

    await policies.create({
      agencyId,
      branchId,
      legacySmartSuiteId: `renewal-e2e:${policyNumber}`,
      policyNumber,
      policyType,
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

  /**
   * The Proactive Renewal Outreach desk (PAC-143): a renewal is on it for the
   * two weeks before its renewal period starts — T-104..T-90 annual,
   * T-59..T-45 auto — and nowhere else, so it never sits on the desk and in
   * the Agency Priority queue at once.
   */
  describe('Proactive Renewal Outreach desk (PAC-143)', () => {
    const deskPolicies = async () =>
      (await tickets.renewalDesk(access))
        .map((row) => row.policies[0]?.policyNumber)
        .sort();

    it('previews first calls opening within two weeks, and nothing already open', async () => {
      await seedBook(50, 'DESK-AUTO-SOON'); // T-45 call opens in 5 days
      await seedBook(40, 'DESK-AUTO-OPEN'); // opened 5 days ago
      await seedBook(70, 'DESK-AUTO-LATER'); // opens in 25 days
      await seedBook(100, 'DESK-HOME-SOON', 'Home'); // T-90 opens in 10 days
      await seedBook(80, 'DESK-HOME-OPEN', 'Home'); // T-90 opened 10 days ago

      await tickets.materializeRenewalCycles(access);

      expect(await deskPolicies()).toEqual([
        'DESK-AUTO-SOON',
        'DESK-HOME-SOON',
      ]);
    });

    it('creates an annual cycle early enough to preview its T-90 review', async () => {
      // 100 days out is past the old 90-day horizon: without the preview
      // window on top, this cycle would not exist yet.
      await seedBook(100, 'DESK-HOME-HORIZON', 'Home');

      await tickets.materializeRenewalCycles(access);

      expect(await cycles.countDocuments({ agencyId })).toBe(1);
      const [row] = await tickets.renewalDesk(access);
      expect(row.stepKey).toBe('annual_review');
      expect(row.daysUntilAvailable).toBeGreaterThanOrEqual(9);
      expect(row.isActionable).toBe(false);
    });

    it('does not preview a later call once the renewal period has started', async () => {
      // An annual cycle whose T-90 review has no ticket — as at the cutover,
      // where a stale warm-up is suppressed. Its T-45 call has not opened, but
      // the renewal period it belongs to already has.
      await seedBook(50, 'DESK-HOME-NO-WARMUP', 'Home');
      await tickets.materializeRenewalCycles(access);
      await ticketModel.deleteMany({
        agencyId,
        'renewal.stepKey': 'annual_review',
      });

      expect(await deskPolicies()).toEqual([]);
    });

    it('lists soonest-opening first', async () => {
      await seedBook(58, 'DESK-AUTO-13'); // opens in 13 days
      await seedBook(47, 'DESK-AUTO-2'); // opens in 2 days

      await tickets.materializeRenewalCycles(access);

      expect(
        (await tickets.renewalDesk(access)).map(
          (row) => row.policies[0]?.policyNumber,
        ),
      ).toEqual(['DESK-AUTO-2', 'DESK-AUTO-13']);
    });

    /**
     * PAC-146: an owner or branch manager sees everyone's renewals on the
     * desk; a rep sees only their own. Scope, not role name, decides.
     */
    describe('whose renewals (PAC-146)', () => {
      const colleagueId = new Types.ObjectId();
      const scoped = (dataScope: DataScope, branch = branchId) => ({
        ...access,
        dataScope,
        branchId: branch.toHexString(),
      });

      beforeEach(async () => {
        await seedBook(50, 'DESK-MINE');
        await seedBook(51, 'DESK-COLLEAGUE', 'Auto', colleagueId);
        await tickets.materializeRenewalCycles(access);
      });

      it('an agency-scoped owner sees every renewal, and whose each is', async () => {
        const rows = await tickets.renewalDesk(scoped(DataScope.Agency));
        expect(rows.map((r) => r.policies[0]?.policyNumber).sort()).toEqual([
          'DESK-COLLEAGUE',
          'DESK-MINE',
        ]);
        const colleagues = rows.find(
          (r) => r.policies[0]?.policyNumber === 'DESK-COLLEAGUE',
        );
        expect(colleagues?.assignedUserId).toBe(colleagueId.toHexString());
      });

      it('a branch-scoped manager sees their branch, and no other', async () => {
        expect(
          await tickets.renewalDesk(scoped(DataScope.Branch)),
        ).toHaveLength(2);
        expect(
          await tickets.renewalDesk(
            scoped(DataScope.Branch, new Types.ObjectId()),
          ),
        ).toEqual([]);
      });

      it('an own-scoped rep sees only their own — not the branch floor', async () => {
        const rows = await tickets.renewalDesk(scoped(DataScope.Own));
        expect(rows.map((r) => r.policies[0]?.policyNumber)).toEqual([
          'DESK-MINE',
        ]);
      });
    });
  });
});
