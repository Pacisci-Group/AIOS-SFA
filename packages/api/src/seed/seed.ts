import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import {
  ALL_MODULE_KEYS,
  DEFAULT_ONBOARDING_STEP_DEFINITIONS,
  ONBOARDING_STEP_KEYS,
  ONBOARDING_STEP_LABELS,
  RENEWAL_TERM_MONTHS,
  renewalTrackFor,
} from '@sfa/shared';
import type { OnboardingStepKey } from '@sfa/shared';
import { AppModule } from '../app.module';
import { Branch } from '../branches/schemas/branch.schema';
import { Contact } from '../contacts/schemas/contact.schema';
import { scheduleSteps } from '../crm/onboarding/onboarding-scheduling';
import { Onboarding } from '../crm/schemas/onboarding.schema';
import { OnboardingStepDefinitionRecord } from '../crm/schemas/onboarding-step-definition.schema';
import { ServiceTicket } from '../crm/schemas/service-ticket.schema';
import { Household } from '../households/schemas/household.schema';
import { PermissionsService } from '../permissions/permissions.service';
import { Policy } from '../policies/schemas/policy.schema';
import { Agency } from '../platform/schemas/agency.schema';
import { AgencyRole } from '../roles/schemas/agency-role.schema';
import { User } from '../users/schemas/user.schema';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const agencyModel = app.get<Model<Agency>>(getModelToken(Agency.name));
  const branchModel = app.get<Model<Branch>>(getModelToken(Branch.name));
  const userModel = app.get<Model<User>>(getModelToken(User.name));
  const roleModel = app.get<Model<AgencyRole>>(getModelToken(AgencyRole.name));
  const ticketModel = app.get<Model<ServiceTicket>>(
    getModelToken(ServiceTicket.name),
  );
  const householdModel = app.get<Model<Household>>(
    getModelToken(Household.name),
  );
  const policyModel = app.get<Model<Policy>>(getModelToken(Policy.name));
  const contactModel = app.get<Model<Contact>>(getModelToken(Contact.name));
  const stepDefinitionModel = app.get<Model<OnboardingStepDefinitionRecord>>(
    getModelToken(OnboardingStepDefinitionRecord.name),
  );
  const onboardingModel = app.get<Model<Onboarding>>(
    getModelToken(Onboarding.name),
  );
  const permissionsService = app.get(PermissionsService);

  const superAdminEmail =
    process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@sfa.local';
  const superAdminPassword =
    process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const modules = Object.fromEntries(
    ALL_MODULE_KEYS.map((key) => [key, { enabled: true }]),
  );

  let agency = await agencyModel.findOne({ slug: 'smith-family-agency' });
  if (!agency) {
    agency = await agencyModel.create({
      name: 'Smith Family Agency',
      slug: 'smith-family-agency',
      status: 'active',
      modules,
    });
    console.log('Created agency: Smith Family Agency');
  } else {
    console.log('Agency already exists, skipping create');
  }

  await permissionsService.seedDefaultRoles(agency._id);
  console.log('Default agency roles seeded');

  let branch = await branchModel.findOne({
    agencyId: agency._id,
    slug: 'main',
  });
  if (!branch) {
    branch = await branchModel.create({
      agencyId: agency._id,
      name: 'Main',
      slug: 'main',
      isDefault: true,
    });
    console.log('Created branch: Main');
  } else {
    console.log('Branch already exists, skipping create');
  }

  const ownerRole = await roleModel.findOne({
    agencyId: agency._id,
    slug: 'agency_owner',
  });

  const producerRole = await roleModel.findOne({
    agencyId: agency._id,
    slug: 'producer',
  });

  const csrRole = await roleModel.findOne({
    agencyId: agency._id,
    slug: 'csr',
  });

  const existingSuperAdmin = await userModel.findOne({
    email: superAdminEmail,
  });
  if (!existingSuperAdmin) {
    await userModel.create({
      email: superAdminEmail,
      passwordHash: await bcrypt.hash(superAdminPassword, 12),
      isPlatformAdmin: true,
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
    });
    console.log(`Created super admin: ${superAdminEmail}`);
  } else {
    await userModel.updateOne(
      { _id: existingSuperAdmin._id },
      { $set: { isPlatformAdmin: true }, $unset: { roles: 1 } },
    );
    console.log('Super admin updated');
  }

  const ownerEmail =
    process.env.SEED_AGENCY_OWNER_EMAIL ?? 'owner@smithfamily.local';
  const ownerPassword =
    process.env.SEED_AGENCY_OWNER_PASSWORD ?? 'ChangeMe123!';

  const existingOwner = await userModel.findOne({ email: ownerEmail });
  if (!existingOwner) {
    await userModel.create({
      agencyId: agency._id,
      email: ownerEmail,
      passwordHash: await bcrypt.hash(ownerPassword, 12),
      roleIds: ownerRole ? [ownerRole._id] : [],
      firstName: 'Agency',
      lastName: 'Owner',
      isActive: true,
    });
    console.log(`Created agency owner: ${ownerEmail}`);
  } else if (ownerRole) {
    await userModel.updateOne(
      { _id: existingOwner._id },
      {
        $set: { roleIds: [ownerRole._id] },
        $unset: { roles: 1 },
      },
    );
    console.log('Agency owner updated with agency_owner role');
  }

  const producerEmail =
    process.env.SEED_PRODUCER_EMAIL ?? 'producer@smithfamily.local';
  const producerPassword = process.env.SEED_PRODUCER_PASSWORD ?? 'ChangeMe123!';

  const existingProducer = await userModel.findOne({ email: producerEmail });
  if (!existingProducer) {
    await userModel.create({
      agencyId: agency._id,
      branchId: branch._id,
      email: producerEmail,
      passwordHash: await bcrypt.hash(producerPassword, 12),
      roleIds: producerRole ? [producerRole._id] : [],
      firstName: 'Pat',
      lastName: 'Producer',
      isActive: true,
    });
    console.log(`Created producer: ${producerEmail}`);
  } else if (producerRole) {
    await userModel.updateOne(
      { _id: existingProducer._id },
      {
        $set: {
          roleIds: [producerRole._id],
          agencyId: agency._id,
          branchId: branch._id,
        },
        $unset: { roles: 1 },
      },
    );
    console.log('Producer updated with producer role');
  }

  const csrEmail = process.env.SEED_CSR_EMAIL ?? 'csr@smithfamily.local';
  const csrPassword = process.env.SEED_CSR_PASSWORD ?? 'ChangeMe123!';

  const existingCsr = await userModel.findOne({ email: csrEmail });
  if (!existingCsr) {
    await userModel.create({
      agencyId: agency._id,
      branchId: branch._id,
      email: csrEmail,
      passwordHash: await bcrypt.hash(csrPassword, 12),
      roleIds: csrRole ? [csrRole._id] : [],
      firstName: 'Casey',
      lastName: 'CSR',
      isActive: true,
    });
    console.log(`Created CSR: ${csrEmail}`);
  } else if (csrRole) {
    await userModel.updateOne(
      { _id: existingCsr._id },
      {
        $set: {
          roleIds: [csrRole._id],
          agencyId: agency._id,
          branchId: branch._id,
        },
        $unset: { roles: 1 },
      },
    );
    console.log('CSR updated with csr role');
  }

  // ── Service tickets (CRM Service dashboard + ticket workspace) ──────────
  const csrUser = await userModel.findOne({ email: csrEmail });
  const producerUser = await userModel.findOne({ email: producerEmail });

  const existingTickets = await ticketModel.countDocuments({
    agencyId: agency._id,
  });
  if (existingTickets === 0) {
    const csrName = 'Casey CSR';
    const producerName = 'Pat Producer';
    const day = 24 * 60 * 60 * 1000;
    const hour = 60 * 60 * 1000;
    const now = Date.now();

    const seededTickets = [
      {
        ticketNumber: 'RENEW-280',
        clientName: 'Meredith Dunning',
        category: 'Renewal Review',
        status: 'open',
        priority: 'high',
        assignee: csrUser,
        assignedRep: csrName,
        policyNumber: '969893347',
        policyType: 'Auto',
        household: 'Dunning Household',
        phone: '(512) 874-3301',
        email: 'm.dunning@email.com',
        openedDaysAgo: 12,
        timeline: [
          {
            type: 'created',
            at: now - 12 * day,
            content:
              'Ticket opened. Client called in to review upcoming auto policy renewal — rate increase of $47/mo flagged.',
          },
          {
            type: 'system',
            at: now - 12 * day + hour,
            content: 'Policy auto-renewal notice sent to client email on file.',
          },
          {
            type: 'call',
            author: csrName,
            at: now - 11 * day,
            content:
              'Outbound call placed — no answer. Left voicemail requesting callback.',
          },
          {
            type: 'note',
            author: csrName,
            at: now - 2 * hour,
            content:
              'Client returned call. Explained statewide rate adjustment. Submitted loyalty discount review to underwriting.',
          },
        ],
      },
      {
        ticketNumber: 'CLAIM-441',
        clientName: 'James Okafor',
        category: 'Claims Assist',
        status: 'overdue',
        priority: 'high',
        assignee: csrUser,
        assignedRep: csrName,
        policyNumber: '774821003',
        policyType: 'Home',
        household: 'Okafor Household',
        phone: '(737) 200-9912',
        email: 'jokafor@gmail.com',
        openedDaysAgo: 15,
        timeline: [
          {
            type: 'created',
            at: now - 15 * day,
            content:
              'Claim inquiry opened. Water damage from burst pipe — adjuster visit requested.',
          },
          {
            type: 'note',
            author: csrName,
            at: now - 13 * day,
            content: 'Adjuster scheduled. Client notified.',
          },
        ],
      },
      {
        ticketNumber: 'BILL-092',
        clientName: 'Sandra Krause',
        category: 'Billing',
        status: 'waiting',
        priority: 'medium',
        assignee: csrUser,
        assignedRep: csrName,
        policyNumber: '331047829',
        policyType: 'Life',
        household: 'Krause Household',
        phone: '(214) 556-7740',
        email: 'sandrak@outlook.com',
        openedDaysAgo: 5,
        timeline: [
          {
            type: 'created',
            at: now - 5 * day,
            content:
              'Client reported double charge on statement. Awaiting billing dept review.',
          },
        ],
      },
      {
        ticketNumber: 'PCHG-317',
        clientName: 'Tom Weatherford',
        category: 'Policy Change',
        status: 'open',
        priority: 'medium',
        assignee: csrUser,
        assignedRep: csrName,
        policyNumber: '882001456',
        policyType: 'Auto',
        household: 'Weatherford Household',
        phone: '(469) 883-1120',
        email: 'tweatherford@yahoo.com',
        openedDaysAgo: 3,
        timeline: [
          {
            type: 'created',
            at: now - 3 * day,
            content:
              'Client adding a 2023 Ford F-150 to existing auto policy. Needs updated declaration page.',
          },
        ],
      },
      {
        ticketNumber: 'CVGQ-511',
        clientName: 'Henry Liu',
        category: 'Other',
        status: 'waiting',
        priority: 'low',
        assignee: csrUser,
        assignedRep: csrName,
        policyNumber: '990124873',
        policyType: 'Umbrella',
        household: 'Liu Household',
        phone: '(713) 660-2244',
        email: 'henry.liu@corp.com',
        openedDaysAgo: 2,
        timeline: [
          {
            type: 'created',
            at: now - 2 * day,
            content:
              'Client asking whether umbrella policy covers rental property liability. Forwarded to senior underwriter.',
          },
        ],
      },
      {
        ticketNumber: 'RENEW-301',
        clientName: 'Patrick Ellison',
        category: 'Renewal Review',
        status: 'resolved',
        priority: 'low',
        assignee: csrUser,
        assignedRep: csrName,
        policyNumber: '445780334',
        policyType: 'Home',
        household: 'Ellison Household',
        phone: '(817) 993-4451',
        email: 'pellison@work.com',
        openedDaysAgo: 6,
        timeline: [
          {
            type: 'created',
            at: now - 6 * day,
            content: 'Annual homeowner renewal review initiated.',
          },
          {
            type: 'note',
            author: csrName,
            at: now - 2 * day,
            content: 'Client confirmed renewal. No changes requested.',
          },
          {
            type: 'status',
            author: 'System',
            at: now - 3 * hour,
            content: 'Status changed: Open → Resolved',
          },
        ],
      },
      {
        ticketNumber: 'PREM-158',
        clientName: 'Donna Vasquez',
        category: 'Billing',
        status: 'overdue',
        priority: 'high',
        assignee: producerUser,
        assignedRep: producerName,
        policyNumber: '554390021',
        policyType: 'Home',
        household: 'Vasquez Household',
        phone: '(832) 447-0033',
        email: 'dvasquez@email.com',
        openedDaysAgo: 18,
        timeline: [
          {
            type: 'created',
            at: now - 18 * day,
            content:
              'Client disputes 22% premium hike. Requesting detailed breakdown from underwriting.',
          },
        ],
      },
      {
        ticketNumber: 'CANC-078',
        clientName: 'Rachel Simmons',
        category: 'Termination',
        status: 'open',
        priority: 'high',
        assignee: producerUser,
        assignedRep: producerName,
        policyNumber: '667234190',
        policyType: 'Auto',
        household: 'Simmons Household',
        phone: '(512) 321-8874',
        email: 'rsimmons@gmail.com',
        openedDaysAgo: 1,
        timeline: [
          {
            type: 'created',
            at: now - 1 * day,
            content:
              'Client requesting cancellation of auto policy effective month-end. Moving out of state.',
          },
        ],
      },
      // Resolved long enough ago to sit past the 7-day archive window — these
      // show up under Archived Tickets, not the Resolved tab.
      {
        ticketNumber: 'BILL-204',
        clientName: 'Marcus Whitfield',
        category: 'Billing',
        status: 'resolved',
        priority: 'medium',
        assignee: csrUser,
        assignedRep: csrName,
        policyNumber: '778102455',
        policyType: 'Auto',
        household: 'Whitfield Household',
        phone: '(469) 220-7781',
        email: 'mwhitfield@email.com',
        openedDaysAgo: 24,
        timeline: [
          {
            type: 'created',
            at: now - 24 * day,
            content:
              'Duplicate autopay draft reported for the March billing cycle.',
          },
          {
            type: 'call',
            author: csrName,
            at: now - 20 * day,
            content:
              'Confirmed duplicate draft with billing. Refund submitted.',
          },
          {
            type: 'status',
            author: 'System',
            at: now - 18 * day,
            content: 'Status changed: Open → Resolved',
          },
        ],
      },
      {
        ticketNumber: 'PCHG-119',
        clientName: 'Sofia Marchetti',
        category: 'Policy Change',
        status: 'resolved',
        priority: 'low',
        assignee: producerUser,
        assignedRep: producerName,
        policyNumber: '889340172',
        policyType: 'Home',
        household: 'Marchetti Household',
        phone: '(210) 556-9034',
        email: 'sofia.marchetti@email.com',
        openedDaysAgo: 15,
        timeline: [
          {
            type: 'created',
            at: now - 15 * day,
            content:
              'Client adding a detached garage to the dwelling coverage.',
          },
          {
            type: 'email',
            author: producerName,
            at: now - 12 * day,
            content: 'Endorsement issued and confirmation emailed to client.',
          },
          {
            type: 'status',
            author: 'System',
            at: now - 11 * day,
            content: 'Status changed: Open → Resolved',
          },
        ],
      },
    ] as const;

    await ticketModel.insertMany(
      seededTickets.map((t) => {
        const openedAt = new Date(now - t.openedDaysAgo * day);
        const timeline = t.timeline.map((e) => ({
          type: e.type,
          author: 'author' in e ? e.author : undefined,
          content: e.content,
          at: new Date(e.at),
        }));
        const lastActivityAt = timeline.reduce(
          (max, e) => (e.at > max ? e.at : max),
          openedAt,
        );
        return {
          agencyId: agency._id,
          branchId: branch._id,
          ticketNumber: t.ticketNumber,
          clientName: t.clientName,
          category: t.category,
          status: t.status,
          priority: t.priority,
          assignedRep: t.assignedRep,
          assignedUserId: t.assignee?._id ?? null,
          policyNumber: t.policyNumber,
          policyType: t.policyType,
          household: t.household,
          phone: t.phone,
          email: t.email,
          openedAt,
          lastActivityAt,
          // For seeded tickets the resolve is always the newest timeline entry.
          resolvedAt: t.status === 'resolved' ? lastActivityAt : null,
          timeline,
        };
      }),
    );
    console.log(`Seeded ${seededTickets.length} service tickets`);
  } else {
    console.log(
      `Service tickets already exist (${existingTickets}), skipping ticket seed`,
    );
  }

  // ── Onboarding step definitions ─────────────────────────────────────────
  // Timing config lives in the database, not in code, so an agency can retune
  // its cadence without a deploy. Upserted (not insert-guarded) so re-running
  // the seed repairs a partially-configured agency.
  for (const definition of DEFAULT_ONBOARDING_STEP_DEFINITIONS) {
    await stepDefinitionModel.updateOne(
      { agencyId: agency._id, stepKey: definition.stepKey },
      { $set: { ...definition, agencyId: agency._id, active: true } },
      { upsert: true },
    );
  }
  console.log(
    `Seeded ${DEFAULT_ONBOARDING_STEP_DEFINITIONS.length} onboarding step definitions`,
  );

  // ── Client records (households / contacts / policies) ───────────────────
  // Runs OUTSIDE the ticket-seed guard above so tickets that were seeded on an
  // earlier run still pick up their householdId/policyId links.
  //
  // NOTE: these collections extend `TenantRecord`, whose agencyId/branchId are
  // plain STRINGS — unlike ServiceTicket, which stores them as ObjectIds.
  const tenant = {
    agencyId: agency._id.toString(),
    branchId: branch._id.toString(),
  };
  const day = 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const clientRecords = [
    {
      slug: 'dunning',
      // Auto (6mo): merged call open — 40 days out
      renewalInDays: 40,
      ticketNumber: 'RENEW-280',
      clientName: 'Meredith Dunning',
      household: 'Dunning Household',
      policyNumber: '969893347',
      policyType: 'Auto',
      premium: 1840,
      phone: '(512) 874-3301',
      email: 'm.dunning@email.com',
      assignee: csrUser,
      address: {
        line1: '4419 Ridgemont Dr',
        city: 'Austin',
        state: 'TX',
        postalCode: '78731',
      },
    },
    {
      slug: 'okafor',
      // Home: annual review just opened — 88 days out
      renewalInDays: 88,
      ticketNumber: 'CLAIM-441',
      clientName: 'James Okafor',
      household: 'Okafor Household',
      policyNumber: '774821003',
      policyType: 'Home',
      premium: 2360,
      phone: '(737) 200-9912',
      email: 'jokafor@gmail.com',
      assignee: csrUser,
      address: {
        line1: '1208 Wells Branch Pkwy',
        city: 'Austin',
        state: 'TX',
        postalCode: '78728',
      },
    },
    {
      slug: 'krause',
      // Life: renewal review open — 30 days out
      renewalInDays: 30,
      ticketNumber: 'BILL-092',
      clientName: 'Sandra Krause',
      household: 'Krause Household',
      policyNumber: '331047829',
      policyType: 'Life',
      premium: 960,
      phone: '(214) 556-7740',
      email: 'sandrak@outlook.com',
      assignee: csrUser,
      address: {
        line1: '77 Preston Hollow Ln',
        city: 'Dallas',
        state: 'TX',
        postalCode: '75225',
      },
    },
    {
      slug: 'weatherford',
      // Auto (6mo): merged call still scheduled — 75 days out
      renewalInDays: 75,
      ticketNumber: 'PCHG-317',
      clientName: 'Tom Weatherford',
      household: 'Weatherford Household',
      policyNumber: '882001456',
      policyType: 'Auto',
      premium: 1515,
      phone: '(469) 883-1120',
      email: 'tweatherford@yahoo.com',
      assignee: csrUser,
      address: {
        line1: '9032 Legacy Bend',
        city: 'Plano',
        state: 'TX',
        postalCode: '75024',
      },
    },
    {
      slug: 'liu',
      // Umbrella: renewal review overdue — renews in 5 days
      renewalInDays: 5,
      ticketNumber: 'CVGQ-511',
      clientName: 'Henry Liu',
      household: 'Liu Household',
      policyNumber: '990124873',
      policyType: 'Umbrella',
      premium: 640,
      phone: '(713) 660-2244',
      email: 'henry.liu@corp.com',
      assignee: csrUser,
      address: {
        line1: '2255 Memorial Dr',
        city: 'Houston',
        state: 'TX',
        postalCode: '77007',
      },
    },
    {
      slug: 'ellison',
      // Home: outside the 90-day horizon entirely
      renewalInDays: 120,
      ticketNumber: 'RENEW-301',
      clientName: 'Patrick Ellison',
      household: 'Ellison Household',
      policyNumber: '445780334',
      policyType: 'Home',
      premium: 2075,
      phone: '(817) 993-4451',
      email: 'pellison@work.com',
      assignee: csrUser,
      address: {
        line1: '618 Hulen Meadow Ct',
        city: 'Fort Worth',
        state: 'TX',
        postalCode: '76132',
      },
    },
    {
      slug: 'vasquez',
      // Home: annual review overdue — 60 days out
      renewalInDays: 60,
      ticketNumber: 'PREM-158',
      clientName: 'Donna Vasquez',
      household: 'Vasquez Household',
      policyNumber: '554390021',
      policyType: 'Home',
      premium: 2490,
      phone: '(832) 447-0033',
      email: 'dvasquez@email.com',
      assignee: producerUser,
      address: {
        line1: '13 Cypress Station Dr',
        city: 'Houston',
        state: 'TX',
        postalCode: '77090',
      },
    },
    {
      slug: 'simmons',
      // Auto (6mo): already renewed 4 days ago, inside the grace window
      renewalInDays: -4,
      ticketNumber: 'CANC-078',
      clientName: 'Rachel Simmons',
      household: 'Simmons Household',
      policyNumber: '667234190',
      policyType: 'Auto',
      premium: 1320,
      phone: '(512) 321-8874',
      email: 'rsimmons@gmail.com',
      assignee: producerUser,
      address: {
        line1: '806 Slaughter Ln',
        city: 'Austin',
        state: 'TX',
        postalCode: '78748',
      },
    },
  ];

  for (const record of clientRecords) {
    const [firstName, ...rest] = record.clientName.split(' ');
    const lastName = rest.join(' ');

    // Upsert on the (agencyId, legacySmartSuiteId) unique sparse index so
    // re-running the seed updates rather than duplicating.
    const household = await householdModel.findOneAndUpdate(
      {
        agencyId: tenant.agencyId,
        legacySmartSuiteId: `seed:hh:${record.slug}`,
      },
      {
        $set: {
          ...tenant,
          name: record.household,
          status: 'Active',
          primaryContactName: record.clientName,
          primaryEmails: [record.email],
          primaryPhones: [record.phone],
          propertyAddress: record.address,
          mailingAddress: record.address,
          assignedCrmId: record.assignee?._id ?? null,
          totalActivePolicies: 1,
          isTestRecord: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await contactModel.findOneAndUpdate(
      {
        agencyId: tenant.agencyId,
        legacySmartSuiteId: `seed:ct:${record.slug}`,
      },
      {
        $set: {
          ...tenant,
          firstName,
          lastName,
          emails: [record.email],
          phones: [record.phone],
          roleInHousehold: 'Named Insured',
          isPrimary: true,
          householdId: household._id,
          isTestRecord: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const policy = await policyModel.findOneAndUpdate(
      {
        agencyId: tenant.agencyId,
        legacySmartSuiteId: `seed:pol:${record.slug}`,
      },
      {
        $set: {
          ...tenant,
          policyNumber: record.policyNumber,
          policyType: record.policyType,
          carrier: 'Pacific Standard',
          active: true,
          policyStatus: 'Active',
          premium: record.premium,
          items: 1,
          // Renewal dates are spread across the outreach bands so the Proactive
          // Renewal Outreach desk has something real to render straight after a
          // seed. Term length follows the line: auto renews every 6 months,
          // everything else annually.
          effectiveDate: new Date(
            nowMs +
              record.renewalInDays * day -
              RENEWAL_TERM_MONTHS[renewalTrackFor(record.policyType)] *
                30 *
                day,
          ),
          expirationDate: new Date(nowMs + record.renewalInDays * day),
          renewalDate: new Date(nowMs + record.renewalInDays * day),
          householdId: household._id,
          isTestRecord: false,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await ticketModel.updateOne(
      { agencyId: agency._id, ticketNumber: record.ticketNumber },
      { $set: { householdId: household._id, policyId: policy._id } },
    );
  }
  console.log(
    `Seeded/linked ${clientRecords.length} households + contacts + policies`,
  );

  // ── Onboarding chains ───────────────────────────────────────────────────
  // Onboarding is tracked PER CLIENT: an `Onboarding` record plus one ticket
  // per call, chained. Seeded after the client records above because every
  // onboarding requires a real household.
  //
  // The four fixtures cover each state a chain can be in, including a
  // scheduled call that must stay hidden from the queue until it opens.
  const existingOnboardings = await onboardingModel.countDocuments({
    agencyId: agency._id,
  });
  if (existingOnboardings === 0) {
    const csrForOnboarding = await userModel.findOne({ email: csrEmail });
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const seededHouseholds = await householdModel
      .find({ agencyId: tenant.agencyId })
      .sort({ name: 1 })
      .limit(4)
      .lean();

    /**
     * Each fixture pins when the engagement started and which calls are done.
     * Timings come from the real scheduler, so the seed cannot drift away from
     * production behaviour.
     */
    const chains: {
      startedDaysAgo: number;
      completed: Partial<Record<OnboardingStepKey, number>>;
      note: string;
    }[] = [
      // Fresh: welcome call open, comfortably inside its 48h SLA.
      { startedDaysAgo: 0.2, completed: {}, note: 'welcome call open' },
      // Welcome call done yesterday — the 3-day check-in exists but is
      // SCHEDULED, so it must not appear in the queue yet.
      {
        startedDaysAgo: 6,
        completed: { welcome_call: 1 },
        note: '3-day check-in scheduled (hidden)',
      },
      // Never actioned — past the 48h welcome SLA.
      { startedDaysAgo: 5, completed: {}, note: 'welcome call overdue' },
      // A full run: every call made, onboarding complete.
      {
        startedDaysAgo: 40,
        completed: { welcome_call: 39, checkin_3day: 36, checkin_30day: 9 },
        note: 'onboarding complete',
      },
    ];

    let created = 0;
    for (const [index, spec] of chains.entries()) {
      const household = seededHouseholds[index % seededHouseholds.length];
      if (!household) continue;

      const startedAt = new Date(now - spec.startedDaysAgo * day);
      const onboarding = await onboardingModel.create({
        agencyId: agency._id,
        branchId: branch._id,
        householdId: household._id,
        clientName: household.primaryContactName ?? household.name ?? 'Client',
        salesProducerName: 'Pat Producer',
        dealId: null,
        dealAuditId: null,
        assignedCsrId: csrForOnboarding?._id ?? null,
        startedAt,
        currentStepKey: ONBOARDING_STEP_KEYS[0],
        completedAt: null,
        checklist: {
          mortgageeClauseVerified: Boolean(spec.completed.welcome_call),
          loanNumberVerified: Boolean(spec.completed.welcome_call),
          portalAccessVerified: Boolean(spec.completed.checkin_30day),
          rulesOfEngagementSet: Boolean(spec.completed.welcome_call),
          googleReviewRequested: Boolean(spec.completed.checkin_30day),
        },
        emailMilestones: {
          welcomeSent: spec.completed.welcome_call ? startedAt : null,
          day3Sent: spec.completed.checkin_3day ? startedAt : null,
          day7Sent: null,
          day30Sent: spec.completed.checkin_30day ? startedAt : null,
        },
      });

      const completedAtByKey = Object.fromEntries(
        Object.entries(spec.completed).map(([key, daysAgo]) => [
          key,
          new Date(now - daysAgo * day),
        ]),
      ) as Partial<Record<OnboardingStepKey, Date>>;

      const planned = scheduleSteps(
        DEFAULT_ONBOARDING_STEP_DEFINITIONS,
        startedAt,
        completedAtByKey,
      );

      // Only steps that are actually schedulable get a ticket — exactly the
      // rule the chaining logic follows at runtime.
      for (const step of planned) {
        if (!step.availableAt) continue;
        const sequence = ONBOARDING_STEP_KEYS.indexOf(step.stepKey) + 1;
        const label = ONBOARDING_STEP_LABELS[step.stepKey];
        const completedAt = completedAtByKey[step.stepKey] ?? null;

        await ticketModel.create({
          agencyId: agency._id,
          branchId: branch._id,
          ticketNumber: `ONBD-${200 + created * 10 + sequence}`,
          clientName: onboarding.clientName,
          category: 'Onboarding',
          // Stored status is a denormalization; the API re-derives on read.
          status: completedAt ? 'resolved' : 'open',
          priority: 'medium',
          assignedRep: 'Casey CSR',
          assignedUserId: csrForOnboarding?._id ?? null,
          householdId: household._id,
          household: household.name ?? '',
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
            completedBy: completedAt ? (csrForOnboarding?._id ?? null) : null,
            completedByName: completedAt ? 'Casey CSR' : '',
          },
        });
      }

      // Point the record at the first outstanding call, or close it out.
      const nextStepKey =
        ONBOARDING_STEP_KEYS.find((key) => !completedAtByKey[key]) ?? null;
      onboarding.currentStepKey = nextStepKey;
      onboarding.completedAt = nextStepKey
        ? null
        : new Date(now - (spec.completed.checkin_30day ?? 0) * day);
      await onboarding.save();
      created += 1;
    }
    console.log(
      `Seeded ${created} onboarding chains (${chains.map((c) => c.note).join('; ')})`,
    );
  } else {
    console.log(
      `Onboardings already exist (${existingOnboardings}), skipping onboarding seed`,
    );
  }

  console.log('\nSeed complete.');
  console.log(`Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`Agency Owner: ${ownerEmail} / ${ownerPassword}`);
  console.log(`Producer: ${producerEmail} / ${producerPassword}`);
  console.log(`CSR: ${csrEmail} / ${csrPassword}`);

  await app.close();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
