import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { AccessScope, DataScope, renewalTrackFor } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { Branch } from '../branches/schemas/branch.schema';
import { RenewalCycle } from '../crm/schemas/renewal-cycle.schema';
import { RenewalScanState } from '../crm/schemas/renewal-scan-state.schema';
import { ServiceTicket } from '../crm/schemas/service-ticket.schema';
import { ServiceTicketsService } from '../crm/service-tickets.service';
import { Household } from '../households/schemas/household.schema';
import { Agency } from '../platform/schemas/agency.schema';
import { Policy } from '../policies/schemas/policy.schema';
import { User } from '../users/schemas/user.schema';

/**
 * Walkthrough fixtures for proactive renewal outreach, with an emphasis on the
 * **multi-policy bundle**: a client who bought auto + home + umbrella together
 * is one phone call, so it is one ticket carrying a checklist of every policy.
 *
 *   npm run seed:dev -w @sfa/api                                    # once
 *   npx ts-node -r tsconfig-paths/register src/seed/renewal-scenarios.ts
 *   npx ts-node -r tsconfig-paths/register src/seed/renewal-scenarios.ts --clean
 *
 * Re-runnable: it deletes its own households, policies, cycles and tickets
 * first, so you can reset between test passes without touching the main seed.
 *
 * Cycles and their tickets are produced by the **real** materializer, not
 * hand-written here — so what you click through is exactly what production
 * would build from the same book.
 */

const FIXTURE_PREFIX = 'test:renewal:';
const DAY = 24 * 60 * 60 * 1000;

interface FixturePolicy {
  policyNumber: string;
  policyType: string;
  premium: number;
  /** Days from now until this policy renews. Negative means already renewed. */
  renewsInDays: number;
}

interface Scenario {
  slug: string;
  clientName: string;
  householdName: string;
  policies: FixturePolicy[];
  expect: string;
}

const SCENARIOS: Scenario[] = [
  {
    slug: 'bundle-annual-open',
    clientName: 'Thomas & Rhonda Kipchoge',
    householdName: 'Kipchoge Household',
    // The headline case: three lines bought together, all renewing the same
    // week. One deal, one call, three checklist items.
    policies: [
      {
        policyNumber: 'BND-AUTO-001',
        policyType: 'Auto',
        premium: 1740,
        renewsInDays: 88,
      },
      {
        policyNumber: 'BND-HOME-001',
        policyType: 'Home',
        premium: 2410,
        renewsInDays: 88,
      },
      {
        policyNumber: 'BND-UMBR-001',
        policyType: 'Umbrella',
        premium: 620,
        renewsInDays: 90,
      },
    ],
    expect:
      'ONE cycle, annual track (a 12-month line is present) — Annual Review open, ' +
      'Renewal Review scheduled and hidden. Checklist: 3 policies.',
  },
  {
    slug: 'bundle-renewal-open',
    clientName: 'Carmen & Luis Delgado',
    householdName: 'Delgado Household',
    // Same bundle shape, further along: the 45-day call is the live one.
    policies: [
      {
        policyNumber: 'BND-HOME-002',
        policyType: 'Home',
        premium: 3180,
        renewsInDays: 38,
      },
      {
        policyNumber: 'BND-AUTO-002',
        policyType: 'Auto',
        premium: 1520,
        renewsInDays: 40,
      },
    ],
    expect:
      'ONE cycle, annual track — Annual Review overdue, Renewal Review open. ' +
      'Checklist: 2 policies.',
  },
  {
    slug: 'bundle-auto-only',
    clientName: 'Benjamin Nakamura',
    householdName: 'Nakamura Household',
    // Two cars, nothing else. Auto renews every 6 months, so both agendas
    // merge into a single call — there is no 90-day warm-up at all.
    policies: [
      {
        policyNumber: 'BND-AUTO-003',
        policyType: 'Auto',
        premium: 1180,
        renewsInDays: 42,
      },
      {
        policyNumber: 'BND-AUTO-004',
        policyType: 'Auto',
        premium: 940,
        renewsInDays: 44,
      },
    ],
    expect:
      'ONE cycle, semiannual track — exactly ONE merged ticket at T-45, no ' +
      'Annual Review. Checklist: 2 policies.',
  },
  {
    slug: 'bundle-split-terms',
    clientName: 'Olivia Marchetti',
    householdName: 'Marchetti Household',
    // The case that proves grouping is by *renewal window*, not just by client:
    // the auto is on a 6-month term and has drifted months away from the home.
    policies: [
      {
        policyNumber: 'SPL-AUTO-001',
        policyType: 'Auto',
        premium: 1290,
        renewsInDays: 25,
      },
      {
        policyNumber: 'SPL-HOME-001',
        policyType: 'Home',
        premium: 2650,
        renewsInDays: 86,
      },
    ],
    expect:
      'TWO separate cycles — the auto and the home renew months apart, so they ' +
      'are two different conversations. 1 policy on each checklist.',
  },
  {
    slug: 'bundle-overdue',
    clientName: 'Priya & Anand Raghunathan',
    householdName: 'Raghunathan Household',
    // Past the renewal date but inside the 14-day grace window, so it can
    // still be closed out with an outcome.
    policies: [
      {
        policyNumber: 'BND-HOME-003',
        policyType: 'Home',
        premium: 2890,
        renewsInDays: -6,
      },
      {
        policyNumber: 'BND-AUTO-005',
        policyType: 'Auto',
        premium: 1610,
        renewsInDays: -6,
      },
    ],
    expect:
      'ONE cycle, already renewed 6 days ago — inside the grace window, so it ' +
      'is still on the desk and still closeable.',
  },
];

async function run() {
  const clean = process.argv.includes('--clean');
  const app = await NestFactory.createApplicationContext(AppModule);

  const agencyModel = app.get<Model<Agency>>(getModelToken(Agency.name));
  const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const householdModel = app.get<Model<Household>>(
    getModelToken(Household.name),
  );
  const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
  const ticketModel = app.get<Model<ServiceTicket>>(
    getModelToken(ServiceTicket.name),
  );
  const cycleModel = app.get<Model<RenewalCycle>>(
    getModelToken(RenewalCycle.name),
  );
  const scanStateModel = app.get<Model<RenewalScanState>>(
    getModelToken(RenewalScanState.name),
  );
  const ticketsService = app.get(ServiceTicketsService);

  const agency = await agencyModel.findOne({ slug: 'smith-family-agency' });
  const branch = await branchModel.findOne({
    agencyId: agency?._id,
    slug: 'main',
  });
  if (!agency || !branch) {
    console.error(
      'Run `npm run seed:dev -w @sfa/api` first — no agency/branch.',
    );
    await app.close();
    process.exit(1);
  }

  // `Household` and `Policy` are TenantRecords: agencyId/branchId are plain
  // STRINGS here, unlike ServiceTicket/RenewalCycle which use ObjectIds.
  const tenant = {
    agencyId: agency._id.toString(),
    branchId: branch._id.toString(),
  };

  /* ---- Reset: always drop the previous run before rebuilding. ---- */

  const fixtureHouseholds = await householdModel
    .find({
      agencyId: tenant.agencyId,
      legacySmartSuiteId: { $regex: `^${FIXTURE_PREFIX}` },
    })
    .select('_id')
    .lean();
  const householdIds = fixtureHouseholds.map((h) => h._id);

  if (householdIds.length) {
    const cycles = await cycleModel
      .find({ agencyId: agency._id, householdId: { $in: householdIds } })
      .select('_id')
      .lean();
    await ticketModel.deleteMany({
      'renewal.renewalCycleId': { $in: cycles.map((c) => c._id) },
    });
    await cycleModel.deleteMany({ _id: { $in: cycles.map((c) => c._id) } });
    await householdModel.deleteMany({ _id: { $in: householdIds } });
  }
  // Keyed rather than household-scoped, so a partially-failed run still cleans up.
  await policyModel.deleteMany({
    agencyId: tenant.agencyId,
    legacySmartSuiteId: { $regex: `^${FIXTURE_PREFIX}` },
  });

  if (clean) {
    console.log(`\nRemoved ${householdIds.length} renewal fixture clients.\n`);
    await app.close();
    return;
  }

  const csr = await userModel.findOne({ email: 'csr@smithfamily.local' });
  const now = Date.now();

  console.log('\nRenewal outreach fixtures — multi-policy bundles\n');

  for (const scenario of SCENARIOS) {
    const key = `${FIXTURE_PREFIX}${scenario.slug}`;
    const firstName = scenario.clientName.split(' ')[0].toLowerCase();

    const household = await householdModel.create({
      ...tenant,
      legacySmartSuiteId: key,
      name: scenario.householdName,
      status: 'Active',
      primaryContactName: scenario.clientName,
      primaryEmails: [`${firstName}@example.com`],
      primaryPhones: ['(512) 555-0188'],
      assignedCrmId: csr?._id ?? null,
      isTestRecord: true,
    });

    for (const policy of scenario.policies) {
      const renewalDate = new Date(now + policy.renewsInDays * DAY);
      // Term length follows the line: auto every 6 months, everything else
      // annually — which is what makes the merged-call scenarios real.
      const termMonths =
        renewalTrackFor(policy.policyType) === 'semiannual' ? 6 : 12;
      await policyModel.create({
        ...tenant,
        // Its own key per policy: `policies` carries a unique index on
        // {agencyId, legacySmartSuiteId} that indexes explicit nulls, so a
        // second null-keyed fixture policy would collide.
        legacySmartSuiteId: `${key}:${policy.policyNumber}`,
        policyNumber: policy.policyNumber,
        policyType: policy.policyType,
        carrier: 'Pacific Standard',
        active: true,
        policyStatus: 'Active',
        premium: policy.premium,
        items: 1,
        effectiveDate: new Date(renewalDate.getTime() - termMonths * 30 * DAY),
        expirationDate: renewalDate,
        renewalDate,
        householdId: household._id,
        isTestRecord: true,
      });
    }

    console.log(`  ${scenario.slug}`);
    console.log(
      `    ${scenario.clientName} — ${scenario.policies.length} policies`,
    );
    console.log(`    expect: ${scenario.expect}\n`);
  }

  /* ---- Materialize through the real code path. ---- */

  // Clear the throttle so the scan runs now rather than up to 10 minutes later.
  await scanStateModel.deleteMany({ agencyId: agency._id });

  const access: AccessContext = {
    userId: csr?._id.toString() ?? '',
    agencyId: tenant.agencyId,
    branchId: tenant.branchId,
    isPlatformAdmin: false,
    scope: AccessScope.Agency,
    dataScope: DataScope.Agency,
    permissions: ['crm_service:read', 'crm_service:write'],
    // Agency-scoped, so no owner clamp is applied and roles are never consulted.
    roleIds: [],
  };
  await ticketsService.materializeRenewalCycles(access);

  /* ---- Report what the materializer actually built. ---- */

  // Re-read the households: `householdIds` above refers to the *previous* run,
  // which the reset just deleted.
  const created = await householdModel
    .find({
      agencyId: tenant.agencyId,
      legacySmartSuiteId: { $regex: `^${FIXTURE_PREFIX}` },
    })
    .select('_id')
    .lean();
  const built = await cycleModel
    .find({
      agencyId: agency._id,
      householdId: { $in: created.map((h) => h._id) },
    })
    .sort({ renewalDate: 1 })
    .lean();

  console.log('Materialized:\n');
  for (const cycle of built) {
    const tickets = await ticketModel
      .find({ 'renewal.renewalCycleId': cycle._id })
      .sort({ 'renewal.sequence': 1 })
      .lean();
    const days = Math.floor(
      (new Date(cycle.renewalDate).getTime() - now) / DAY,
    );
    console.log(
      `  ${cycle.clientName}  [${cycle.track}]  renews in ${days}d  ` +
        `${cycle.policies.length} polic${cycle.policies.length === 1 ? 'y' : 'ies'}`,
    );
    for (const ticket of tickets) {
      const step = ticket.renewal!;
      const opensIn = Math.floor(
        (new Date(step.availableAt!).getTime() - now) / DAY,
      );
      const state =
        opensIn > 0 ? `scheduled, opens in ${opensIn}d (hidden)` : 'open';
      console.log(
        `      ${ticket.ticketNumber}  ${step.stepKey}  ` +
          `step ${step.sequence}/${step.totalSteps}  — ${state}`,
      );
    }
    for (const policy of cycle.policies) {
      console.log(
        `        [ ] ${policy.policyType.padEnd(9)} ${policy.policyNumber}`,
      );
    }
    console.log('');
  }

  console.log(`${built.length} cycles from ${SCENARIOS.length} clients.`);
  console.log('\nOpen http://localhost:5173/crm/service\n');

  await app.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
