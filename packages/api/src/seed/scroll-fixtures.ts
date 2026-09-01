import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { ServiceTicketCategory, ServiceTicketStatus } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { Branch } from '../branches/schemas/branch.schema';
import { ServiceTicket } from '../crm/schemas/service-ticket.schema';
import { Household } from '../households/schemas/household.schema';
import { Agency } from '../platform/schemas/agency.schema';
import { User } from '../users/schemas/user.schema';

/**
 * Throwaway bulk tickets, purely so the CRM Service dashboard has enough rows
 * to exercise the independently-scrolling workspace columns.
 *
 *   npm run seed -w @sfa/api            # once, for the agency/branch/users
 *   npx ts-node -r tsconfig-paths/register src/seed/scroll-fixtures.ts
 *   npx ts-node -r tsconfig-paths/register src/seed/scroll-fixtures.ts --clean
 *
 * This is NOT production seed data and is not wired into any npm script. Every
 * ticket it writes carries `legacySmartSuiteId: 'test:scroll:<n>'`, which is
 * both how a re-run replaces them and how `--clean` finds them again — nothing
 * else in the system uses that prefix, so the main seed is never touched.
 */

const FIXTURE_PREFIX = 'test:scroll:';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface Fixture {
  clientName: string;
  household: string;
  category: ServiceTicketCategory;
  status: ServiceTicketStatus;
  priority: 'high' | 'medium' | 'low';
  policyType: string;
  /** How long ago the ticket was opened, in days. Drives the "days open" sort. */
  openedDaysAgo: number;
  lastTouch: string;
}

/**
 * 28 rows — comfortably more than one column-height at any sensible viewport,
 * with a spread across the queue's three tabs (All / Overdue / Waiting) so each
 * tab is scrollable on its own rather than only the unfiltered list.
 */
const FIXTURES: Fixture[] = [
  {
    clientName: 'Marcus Whitfield',
    household: 'Whitfield Household',
    category: 'Billing',
    status: 'overdue',
    priority: 'high',
    policyType: 'Home',
    openedDaysAgo: 21,
    lastTouch: 'Left voicemail about the past-due balance',
  },
  {
    clientName: 'Priya Raghunathan',
    household: 'Raghunathan Household',
    category: 'Endorsement',
    status: 'open',
    priority: 'high',
    policyType: 'Auto',
    openedDaysAgo: 3,
    lastTouch: 'Client added a second vehicle',
  },
  {
    clientName: 'Devon Marchetti',
    household: 'Marchetti Household',
    category: 'Claims Assist',
    status: 'overdue',
    priority: 'high',
    policyType: 'Home',
    openedDaysAgo: 17,
    lastTouch: 'Adjuster has not returned the inspection report',
  },
  {
    clientName: 'Sylvia Okonkwo',
    household: 'Okonkwo Household',
    category: 'Renewal Review',
    status: 'open',
    priority: 'medium',
    policyType: 'Home',
    openedDaysAgo: 6,
    lastTouch: 'Sent renewal summary, awaiting review',
  },
  {
    clientName: 'Hank Beaumont',
    household: 'Beaumont Household',
    category: 'Policy Change',
    status: 'waiting_on_client',
    priority: 'medium',
    policyType: 'Auto',
    openedDaysAgo: 9,
    lastTouch: 'Waiting on signed change request',
  },
  {
    clientName: 'Ingrid Solberg',
    household: 'Solberg Household',
    category: 'Payment',
    status: 'open',
    priority: 'low',
    policyType: 'Renters',
    openedDaysAgo: 2,
    lastTouch: 'Card on file declined, new card requested',
  },
  {
    clientName: 'Rashid Al-Amin',
    household: 'Al-Amin Household',
    category: 'Company Transfer',
    status: 'waiting_on_carrier',
    priority: 'medium',
    policyType: 'Home',
    openedDaysAgo: 12,
    lastTouch: 'Carrier reviewing the transfer packet',
  },
  {
    clientName: 'Corinne Delacroix',
    household: 'Delacroix Household',
    category: 'Billing',
    status: 'open',
    priority: 'low',
    policyType: 'Auto',
    openedDaysAgo: 1,
    lastTouch: 'Explained the mid-term premium adjustment',
  },
  {
    clientName: 'Tobias Grantham',
    household: 'Grantham Household',
    category: 'Claims Assist',
    status: 'overdue',
    priority: 'high',
    policyType: 'Auto',
    openedDaysAgo: 25,
    lastTouch: 'Rental car authorization expired',
  },
  {
    clientName: 'Noor Haddadi',
    household: 'Haddadi Household',
    category: 'Endorsement',
    status: 'open',
    priority: 'medium',
    policyType: 'Umbrella',
    openedDaysAgo: 4,
    lastTouch: 'Increasing liability limit to $2M',
  },
  {
    clientName: 'Wendell Pryce',
    household: 'Pryce Household',
    category: 'Save',
    status: 'open',
    priority: 'high',
    policyType: 'Home',
    openedDaysAgo: 5,
    lastTouch: 'Client mentioned a competing quote',
  },
  {
    clientName: 'Anneliese Vogt',
    household: 'Vogt Household',
    category: 'Policy Change',
    status: 'waiting_on_client',
    priority: 'low',
    policyType: 'Home',
    openedDaysAgo: 14,
    lastTouch: 'Waiting on updated mortgagee details',
  },
  {
    clientName: 'Emeka Nwachukwu',
    household: 'Nwachukwu Household',
    category: 'Renewal Review',
    status: 'open',
    priority: 'medium',
    policyType: 'Auto',
    openedDaysAgo: 8,
    lastTouch: 'Reviewed the revised premium with client',
  },
  {
    clientName: 'Josephine Kalani',
    household: 'Kalani Household',
    category: 'Billing',
    status: 'waiting_on_carrier',
    priority: 'medium',
    policyType: 'Renters',
    openedDaysAgo: 11,
    lastTouch: 'Carrier reissuing the invoice',
  },
  {
    clientName: 'Ravi Chandrasekaran',
    household: 'Chandrasekaran Household',
    category: 'Other',
    status: 'open',
    priority: 'low',
    policyType: 'Life',
    openedDaysAgo: 2,
    lastTouch: 'Requested a certificate of insurance',
  },
  {
    clientName: 'Marguerite Boivin',
    household: 'Boivin Household',
    category: 'Claims Assist',
    status: 'open',
    priority: 'high',
    policyType: 'Home',
    openedDaysAgo: 7,
    lastTouch: 'Water damage claim opened Tuesday',
  },
  {
    clientName: 'Stellan Bergqvist',
    household: 'Bergqvist Household',
    category: 'Termination',
    status: 'waiting_on_client',
    priority: 'high',
    policyType: 'Auto',
    openedDaysAgo: 16,
    lastTouch: 'Cancellation request pending confirmation',
  },
  {
    clientName: 'Adaeze Obi',
    household: 'Obi Household',
    category: 'Payment',
    status: 'overdue',
    priority: 'medium',
    policyType: 'Home',
    openedDaysAgo: 19,
    lastTouch: 'Third notice sent, no response',
  },
  {
    clientName: 'Lachlan Mercer',
    household: 'Mercer Household',
    category: 'Endorsement',
    status: 'open',
    priority: 'low',
    policyType: 'Auto',
    openedDaysAgo: 3,
    lastTouch: 'Removing a driver from the policy',
  },
  {
    clientName: 'Yasmin Farouk',
    household: 'Farouk Household',
    category: 'Renewal Review',
    status: 'waiting_on_carrier',
    priority: 'medium',
    policyType: 'Umbrella',
    openedDaysAgo: 10,
    lastTouch: 'Awaiting the renewal declaration page',
  },
  {
    clientName: 'Bartholomew Quinn',
    household: 'Quinn Household',
    category: 'Billing',
    status: 'open',
    priority: 'low',
    policyType: 'Home',
    openedDaysAgo: 1,
    lastTouch: 'Set up autopay for the client',
  },
  {
    clientName: 'Ottoline Fairbanks',
    household: 'Fairbanks Household',
    category: 'Policy Change',
    status: 'overdue',
    priority: 'high',
    policyType: 'Home',
    openedDaysAgo: 23,
    lastTouch: 'Roof update never submitted to the carrier',
  },
  {
    clientName: 'Kwame Asante',
    household: 'Asante Household',
    category: 'Claims Assist',
    status: 'waiting_on_carrier',
    priority: 'medium',
    policyType: 'Auto',
    openedDaysAgo: 13,
    lastTouch: 'Total-loss valuation in review',
  },
  {
    clientName: 'Freya Lindholm',
    household: 'Lindholm Household',
    category: 'Save',
    status: 'open',
    priority: 'high',
    policyType: 'Home',
    openedDaysAgo: 4,
    lastTouch: 'Rate increase pushback, offered a re-shop',
  },
  {
    clientName: 'Desmond Achebe',
    household: 'Achebe Household',
    category: 'Other',
    status: 'open',
    priority: 'low',
    policyType: 'Renters',
    openedDaysAgo: 6,
    lastTouch: 'Address change confirmed',
  },
  {
    clientName: 'Isolde Kravchenko',
    household: 'Kravchenko Household',
    category: 'Endorsement',
    status: 'waiting_on_client',
    priority: 'medium',
    policyType: 'Home',
    openedDaysAgo: 15,
    lastTouch: 'Needs photos of the detached garage',
  },
  {
    clientName: 'Augustin Perreault',
    household: 'Perreault Household',
    category: 'Payment',
    status: 'open',
    priority: 'medium',
    policyType: 'Auto',
    openedDaysAgo: 5,
    lastTouch: 'Split the premium into installments',
  },
  {
    clientName: 'Ngozi Adeyemi',
    household: 'Adeyemi Household',
    category: 'Renewal Review',
    status: 'overdue',
    priority: 'high',
    policyType: 'Home',
    openedDaysAgo: 20,
    lastTouch: 'Renewal lapses in 9 days, no contact yet',
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
  const ticketModel = app.get<Model<ServiceTicket>>(
    getModelToken(ServiceTicket.name),
  );

  const agency = await agencyModel.findOne({ slug: 'demo-agency' });
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

  // Always clear the previous run first, so re-running replaces rather than
  // duplicates. `--clean` stops here.
  const removedTickets = await ticketModel.deleteMany({
    agencyId: agency._id,
    legacySmartSuiteId: { $regex: `^${FIXTURE_PREFIX}` },
  });
  const removedHouseholds = await householdModel.deleteMany({
    agencyId: agency._id.toString(),
    legacySmartSuiteId: { $regex: `^${FIXTURE_PREFIX}` },
  });

  if (clean) {
    console.log(
      `\nRemoved ${removedTickets.deletedCount} fixture tickets and ` +
        `${removedHouseholds.deletedCount} fixture households.\n`,
    );
    await app.close();
    return;
  }

  const csr = await userModel.findOne({ email: 'csr@smithfamily.local' });
  const now = Date.now();

  // `Household` is a TenantRecord: agencyId/branchId are plain STRINGS here,
  // unlike ServiceTicket which uses ObjectIds. Getting this wrong returns zero
  // documents silently rather than erroring.
  const householdTenant = {
    agencyId: agency._id.toString(),
    branchId: branch._id.toString(),
  };

  console.log(`\nScroll fixtures — ${FIXTURES.length} tickets\n`);

  for (const [index, fixture] of FIXTURES.entries()) {
    const key = `${FIXTURE_PREFIX}${index + 1}`;
    const firstName = fixture.clientName.split(' ')[0].toLowerCase();

    const household = await householdModel.findOneAndUpdate(
      { agencyId: householdTenant.agencyId, legacySmartSuiteId: key },
      {
        $set: {
          ...householdTenant,
          legacySmartSuiteId: key,
          name: fixture.household,
          status: 'Active',
          primaryContactName: fixture.clientName,
          primaryEmails: [`${firstName}@example.com`],
          primaryPhones: ['(512) 555-0142'],
          assignedCrmId: csr?._id ?? null,
          isTestRecord: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const openedAt = new Date(now - fixture.openedDaysAgo * DAY);
    // Spread last activity between "just now" and the open date so the feed's
    // relative labels vary instead of every row reading the same.
    const lastActivityAt = new Date(
      now - Math.round(fixture.openedDaysAgo * 0.4) * DAY - 3 * HOUR,
    );

    await ticketModel.create({
      agencyId: agency._id,
      branchId: branch._id,
      legacySmartSuiteId: key,
      ticketNumber: `SCRL-${String(index + 1).padStart(3, '0')}`,
      clientName: fixture.clientName,
      category: fixture.category,
      status: fixture.status,
      priority: fixture.priority,
      assignedRep: csr ? `${csr.firstName} ${csr.lastName}`.trim() : '',
      assignedUserId: csr?._id ?? null,
      createdByUserId: csr?._id ?? null,
      createdByName: csr ? `${csr.firstName} ${csr.lastName}`.trim() : 'Seed',
      policyNumber: `SC-${100000 + index * 137}`,
      policyType: fixture.policyType,
      household: fixture.household,
      householdId: new Types.ObjectId(household._id.toString()),
      policyId: null,
      phone: '(512) 555-0142',
      email: `${firstName}@example.com`,
      openedAt,
      lastActivityAt,
      resolvedAt: null,
      timeline: [
        {
          type: 'created',
          content: `Ticket opened — ${fixture.category}.`,
          at: openedAt,
        },
        {
          type: 'note',
          author: csr ? `${csr.firstName} ${csr.lastName}`.trim() : 'Seed',
          content: fixture.lastTouch,
          at: lastActivityAt,
        },
      ],
      onboarding: null,
    });

    console.log(
      `  SCRL-${String(index + 1).padStart(3, '0')}  ${fixture.status.padEnd(18)} ${fixture.clientName}`,
    );
  }

  const byStatus = FIXTURES.reduce<Record<string, number>>((acc, f) => {
    acc[f.status] = (acc[f.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n${FIXTURES.length} tickets created:`, byStatus);
  console.log('\nOpen http://localhost:5173/crm/service\n');

  await app.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
