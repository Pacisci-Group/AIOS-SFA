import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { ALL_MODULE_KEYS } from '@sfa/shared';
import { AppModule } from '../app.module';
import { AuditRecord } from '../audit-records/schemas/audit-record.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { Deal, DealType } from '../deals/schemas/deal.schema';
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
  const dealModel = app.get<Model<Deal>>(getModelToken(Deal.name));
  const auditRecordModel = app.get<Model<AuditRecord>>(
    getModelToken(AuditRecord.name),
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

  // Sample "Deals Pending Service Hand-off" data for the dev producer, so the
  // Producer Dashboard board isn't empty without a full SmartSuite migration.
  const producer = await userModel.findOne({ email: producerEmail });
  if (producer) {
    const agencyId = agency._id.toString();
    const branchId = branch._id.toString();
    const SEED_TAG = 'seed-audit-';

    const existingSeeded = await auditRecordModel.countDocuments({
      producerId: producer._id,
      legacySmartSuiteId: { $regex: `^${SEED_TAG}` },
    });

    if (existingSeeded === 0) {
      const samples: Array<{
        client: string;
        type: DealType;
        missing: string;
        days: number;
      }> = [
        {
          client: 'Nathan Rieck',
          type: 'Bundle',
          missing: 'Prior Insurance Proof',
          days: 68,
        },
        {
          client: 'Sandra Watkins',
          type: 'Auto',
          missing: 'Defensive Driver Certificate',
          days: 41,
        },
        {
          client: 'Omar Hassan',
          type: 'Home',
          missing: 'Home Inspection Report',
          days: 29,
        },
        {
          client: 'Priya Sharma',
          type: 'Bundle',
          missing: 'Prior Claims History',
          days: 14,
        },
        {
          client: 'Derek Collins',
          type: 'Auto',
          missing: "Driver's License Copy",
          days: 7,
        },
        {
          client: 'Maria Santos',
          type: 'Home',
          missing: 'Property Deed Verification',
          days: 3,
        },
      ];

      let index = 0;
      for (const sample of samples) {
        const firstCreatedAt = new Date(
          Date.now() - sample.days * 24 * 60 * 60 * 1000,
        );
        const deal = await dealModel.create({
          agencyId,
          branchId,
          clientName: sample.client,
          dealType: sample.type,
          isBundle: sample.type === 'Bundle',
          producerId: producer._id,
          soldDate: firstCreatedAt,
          legacySmartSuiteId: `${SEED_TAG}deal-${index}`,
        });
        await auditRecordModel.create({
          agencyId,
          branchId,
          dealId: deal._id,
          clientName: sample.client,
          producerName: 'Pat Producer',
          producerId: producer._id,
          itemName: sample.missing,
          isFailed: true,
          isResolved: false,
          isTestRecord: false,
          daysOpen: sample.days,
          firstCreatedAt,
          legacySmartSuiteId: `${SEED_TAG}${index}`,
        });
        index++;
      }
      console.log(`Seeded ${samples.length} pending hand-off audit records`);
    } else {
      console.log('Pending hand-off audit records already seeded, skipping');
    }
  }

  console.log('\nSeed complete.');
  console.log(`Super Admin: ${superAdminEmail} / ${superAdminPassword}`);
  console.log(`Agency Owner: ${ownerEmail} / ${ownerPassword}`);
  console.log(`Producer: ${producerEmail} / ${producerPassword}`);

  await app.close();
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
