import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import {
  DEFAULT_ONBOARDING_STEP_DEFINITIONS,
  ONBOARDING_STEP_KEYS,
  ONBOARDING_STEP_LABELS,
} from '@sfa/shared';
import type { OnboardingStepKey } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { Branch } from '../branches/schemas/branch.schema';
import { scheduleSteps } from '../crm/onboarding/onboarding-scheduling';
import { Onboarding } from '../crm/schemas/onboarding.schema';
import { ServiceTicket } from '../crm/schemas/service-ticket.schema';
import { Household } from '../households/schemas/household.schema';
import { Agency } from '../platform/schemas/agency.schema';
import { User } from '../users/schemas/user.schema';

/**
 * Walkthrough fixtures for the onboarding flow.
 *
 * Creates one chain per state a CSR can encounter, so the whole flow can be
 * clicked through without waiting days for timers to mature. Re-runnable: it
 * deletes its own chains first, so you can reset between test passes without
 * touching the main seed's data.
 *
 *   npx ts-node -r tsconfig-paths/register src/seed/onboarding-scenarios.ts
 *
 * Run directly rather than through an npm script — the same bargain
 * `scroll-fixtures.ts`, `post-sale-fixture.ts` and `renewal-scenarios.ts` make.
 * These are dev fixtures for manual QA, not part of any bring-up, and keeping
 * them out of `package.json` keeps that list to the scripts a deploy runs.
 *
 * Timings come from the real scheduler (`scheduleSteps`), so these fixtures
 * cannot drift away from how production actually schedules a chain.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Scenario {
  slug: string;
  clientName: string;
  householdName: string;
  /** When the deal audit was approved, in ms before now. */
  startedAgo: number;
  /** Completed calls, in ms before now. */
  completed: Partial<Record<OnboardingStepKey, number>>;
  expect: string;
}

/**
 * Each scenario works backwards from the state we want the *current* call to
 * be in. A call opens at `availableAt` and is due 48h later, so "awaiting"
 * means opened inside the last 48h and "overdue" means opened more than 48h
 * ago.
 */
const SCENARIOS: Scenario[] = [
  {
    slug: 'fresh-welcome',
    clientName: 'Marcus Webb',
    householdName: 'Webb Household',
    // Just approved: the welcome call is open with most of its 48h left.
    startedAgo: 3 * HOUR,
    completed: {},
    expect: 'Welcome Call — open, due in ~45h',
  },
  {
    slug: 'awaiting-3day',
    clientName: 'Priya Raman',
    householdName: 'Raman Household',
    // Welcome call made 4 days ago, so the 3-day check-in opened yesterday.
    startedAgo: 5 * DAY,
    completed: { welcome_call: 4 * DAY },
    expect: '3-Day Check-In — open, due in ~24h',
  },
  {
    slug: 'overdue-3day',
    clientName: 'Danielle Ortiz',
    householdName: 'Ortiz Household',
    // Welcome call made 6 days ago: the 3-day check-in opened 3 days ago and
    // blew its 48h SLA a day ago.
    startedAgo: 8 * DAY,
    completed: { welcome_call: 6 * DAY },
    expect: '3-Day Check-In — OVERDUE by ~24h',
  },
  {
    slug: 'awaiting-30day',
    clientName: 'Theo Lindqvist',
    householdName: 'Lindqvist Household',
    // Started 31 days ago, so the 30-day check-in (anchored to the start, not
    // the previous call) opened yesterday.
    startedAgo: 31 * DAY,
    completed: { welcome_call: 30 * DAY, checkin_3day: 26 * DAY },
    expect: '30-Day Check-In — open, due in ~24h',
  },
  {
    slug: 'overdue-30day',
    clientName: 'Sandra Krause',
    householdName: 'Krause Household',
    // Started 34 days ago: the 30-day check-in opened 4 days ago and is 2 days
    // past its SLA.
    startedAgo: 34 * DAY,
    completed: { welcome_call: 33 * DAY, checkin_3day: 29 * DAY },
    expect: '30-Day Check-In — OVERDUE by ~48h',
  },
];

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const agencyModel = app.get<Model<Agency>>(getModelToken(Agency.name));
  const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const householdModel = app.get<Model<Household>>(
    getModelToken(Household.name),
  );
  const ticketModel = app.get<Model<ServiceTicket>>(
    getModelToken(ServiceTicket.name),
  );
  const onboardingModel = app.get<Model<Onboarding>>(
    getModelToken(Onboarding.name),
  );

  const agency = await agencyModel.findOne({ slug: 'demo-agency' });
  const branch = await branchModel.findOne({
    agencyId: agency?._id,
    slug: 'main',
  });
  if (!agency || !branch) {
    console.error('Run `npm run seed -w @sfa/api` first — no agency/branch.');
    await app.close();
    process.exit(1);
  }

  const csr = await userModel.findOne({ email: 'csr@smithfamily.local' });
  const now = Date.now();

  // `Household` is a TenantRecord: agencyId/branchId are plain STRINGS here,
  // unlike ServiceTicket/Onboarding which use ObjectIds.
  const tenant = {
    agencyId: agency._id.toString(),
    branchId: branch._id.toString(),
  };

  console.log('\nOnboarding walkthrough fixtures\n');

  for (const [index, scenario] of SCENARIOS.entries()) {
    // Own household per scenario, so a chain is identifiable at a glance and
    // resetting one does not disturb the main seed's clients.
    const household = await householdModel.findOneAndUpdate(
      {
        agencyId: tenant.agencyId,
        legacySmartSuiteId: `test:onboarding:${scenario.slug}`,
      },
      {
        $set: {
          ...tenant,
          name: scenario.householdName,
          status: 'Active',
          primaryContactName: scenario.clientName,
          primaryEmails: [
            `${scenario.clientName.split(' ')[0].toLowerCase()}@example.com`,
          ],
          primaryPhones: ['(512) 555-0100'],
          assignedCrmId: csr?._id ?? null,
          isTestRecord: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Re-runnable: drop this scenario's previous chain before rebuilding it.
    const previous = await onboardingModel
      .find({ agencyId: agency._id, householdId: household._id })
      .select('_id')
      .lean();
    if (previous.length) {
      await ticketModel.deleteMany({
        'onboarding.onboardingId': { $in: previous.map((p) => p._id) },
      });
      await onboardingModel.deleteMany({
        _id: { $in: previous.map((p) => p._id) },
      });
    }

    const startedAt = new Date(now - scenario.startedAgo);
    const completedAtByKey = Object.fromEntries(
      Object.entries(scenario.completed).map(([key, ago]) => [
        key,
        new Date(now - ago),
      ]),
    ) as Partial<Record<OnboardingStepKey, Date>>;

    const nextStepKey =
      ONBOARDING_STEP_KEYS.find((key) => !completedAtByKey[key]) ?? null;

    const onboarding = await onboardingModel.create({
      agencyId: agency._id,
      branchId: branch._id,
      householdId: household._id,
      clientName: scenario.clientName,
      salesProducerName: 'Pat Producer',
      dealId: null,
      dealAuditId: null,
      assignedCsrId: csr?._id ?? null,
      createdByUserId: csr?._id ?? null,
      createdByName: 'Casey CSR',
      openingNote: '',
      householdName: scenario.householdName,
      phone: '(512) 555-0100',
      email: `${scenario.clientName.split(' ')[0].toLowerCase()}@example.com`,
      startedAt,
      currentStepKey: nextStepKey,
      completedAt: nextStepKey ? null : new Date(),
      checklist: {
        // Whatever the welcome call would have covered, if it happened.
        mortgageeClauseVerified: Boolean(completedAtByKey.welcome_call),
        loanNumberVerified: Boolean(completedAtByKey.welcome_call),
        portalAccessVerified: Boolean(completedAtByKey.welcome_call),
        rulesOfEngagementSet: Boolean(completedAtByKey.welcome_call),
        googleReviewRequested: false,
      },
    });

    // Only schedulable steps get a ticket — the same rule the runtime chaining
    // follows, so these fixtures match what the app would have produced.
    const planned = scheduleSteps(
      DEFAULT_ONBOARDING_STEP_DEFINITIONS,
      startedAt,
      completedAtByKey,
    );

    const rows: string[] = [];
    for (const step of planned) {
      if (!step.availableAt) continue;
      const sequence = ONBOARDING_STEP_KEYS.indexOf(step.stepKey) + 1;
      const label = ONBOARDING_STEP_LABELS[step.stepKey];
      const completedAt = completedAtByKey[step.stepKey] ?? null;

      await ticketModel.create({
        agencyId: agency._id,
        branchId: branch._id,
        ticketNumber: `ONBD-T${index + 1}${sequence}`,
        clientName: scenario.clientName,
        category: 'Onboarding',
        status: completedAt ? 'resolved' : 'open',
        priority: 'medium',
        assignedRep: 'Casey CSR',
        assignedUserId: csr?._id ?? null,
        createdByUserId: csr?._id ?? null,
        createdByName: 'Casey CSR',
        householdId: household._id,
        household: scenario.householdName,
        phone: '(512) 555-0100',
        email: `${scenario.clientName.split(' ')[0].toLowerCase()}@example.com`,
        openedAt: step.availableAt,
        lastActivityAt: completedAt ?? step.availableAt,
        resolvedAt: completedAt,
        timeline: [
          {
            type: 'created',
            content:
              sequence === 1
                ? `Onboarding started — ${label}. Sold by Pat Producer.`
                : `${label} scheduled — step ${sequence} of ${ONBOARDING_STEP_KEYS.length}.`,
            at: step.availableAt,
          },
          ...(completedAt
            ? [
                {
                  type: 'system',
                  author: 'Casey CSR',
                  content: `${label} completed.`,
                  at: completedAt,
                },
              ]
            : []),
        ],
        onboarding: {
          onboardingId: onboarding._id,
          stepKey: step.stepKey,
          sequence,
          availableAt: step.availableAt,
          dueAt: step.dueAt,
          completedAt,
          completedBy: completedAt ? (csr?._id ?? null) : null,
          completedByName: completedAt ? 'Casey CSR' : '',
        },
      });

      const state = completedAt
        ? 'done'
        : step.dueAt && step.dueAt.getTime() < now
          ? 'OVERDUE'
          : 'open';
      rows.push(`      ${sequence}. ${label.padEnd(18)} ${state}`);
    }

    console.log(`  ${scenario.clientName.padEnd(18)} ${scenario.expect}`);
    rows.forEach((r) => console.log(r));
    console.log('');
  }

  console.log('Log in as csr@smithfamily.local / ChangeMe123!');
  console.log('Filter the ticket feed to category "Onboarding".\n');

  await app.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
