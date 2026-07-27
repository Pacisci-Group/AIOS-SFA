import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { ALL_MODULE_KEYS } from '@sfa/shared';
import { AppModule } from '../app.module';
import { Branch } from '../branches/schemas/branch.schema';
import { ServiceTicket } from '../crm/schemas/service-ticket.schema';
import { PermissionsService } from '../permissions/permissions.service';
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

  const existingSuperAdmin = await userModel.findOne({ email: superAdminEmail });
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
          { type: 'created', at: now - 12 * day, content: 'Ticket opened. Client called in to review upcoming auto policy renewal — rate increase of $47/mo flagged.' },
          { type: 'system', at: now - 12 * day + hour, content: 'Policy auto-renewal notice sent to client email on file.' },
          { type: 'call', author: csrName, at: now - 11 * day, content: 'Outbound call placed — no answer. Left voicemail requesting callback.' },
          { type: 'note', author: csrName, at: now - 2 * hour, content: 'Client returned call. Explained statewide rate adjustment. Submitted loyalty discount review to underwriting.' },
        ],
      },
      {
        ticketNumber: 'CLAIM-441',
        clientName: 'James Okafor',
        category: 'Claims Inquiry',
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
          { type: 'created', at: now - 15 * day, content: 'Claim inquiry opened. Water damage from burst pipe — adjuster visit requested.' },
          { type: 'note', author: csrName, at: now - 13 * day, content: 'Adjuster scheduled. Client notified.' },
        ],
      },
      {
        ticketNumber: 'BILL-092',
        clientName: 'Sandra Krause',
        category: 'Billing Issue',
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
          { type: 'created', at: now - 5 * day, content: 'Client reported double charge on statement. Awaiting billing dept review.' },
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
          { type: 'created', at: now - 3 * day, content: 'Client adding a 2023 Ford F-150 to existing auto policy. Needs updated declaration page.' },
        ],
      },
      {
        ticketNumber: 'CVGQ-511',
        clientName: 'Henry Liu',
        category: 'Coverage Question',
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
          { type: 'created', at: now - 2 * day, content: 'Client asking whether umbrella policy covers rental property liability. Forwarded to senior underwriter.' },
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
          { type: 'created', at: now - 6 * day, content: 'Annual homeowner renewal review initiated.' },
          { type: 'note', author: csrName, at: now - 2 * day, content: 'Client confirmed renewal. No changes requested.' },
          { type: 'status', author: 'System', at: now - 3 * hour, content: 'Status changed: Open → Resolved' },
        ],
      },
      {
        ticketNumber: 'PREM-158',
        clientName: 'Donna Vasquez',
        category: 'Premium Dispute',
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
          { type: 'created', at: now - 18 * day, content: 'Client disputes 22% premium hike. Requesting detailed breakdown from underwriting.' },
        ],
      },
      {
        ticketNumber: 'CANC-078',
        clientName: 'Rachel Simmons',
        category: 'Cancellation Request',
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
          { type: 'created', at: now - 1 * day, content: 'Client requesting cancellation of auto policy effective month-end. Moving out of state.' },
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
