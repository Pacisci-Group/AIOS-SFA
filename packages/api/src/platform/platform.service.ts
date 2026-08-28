import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ALL_MODULE_KEYS, ModuleKey } from '@sfa/shared';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { Agency, AgencyDocument } from './schemas/agency.schema';

@Injectable()
export class PlatformService {
  constructor(
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    private roleAssignments: RoleAssignmentsService,
    private accessResolver: AccessResolverService,
  ) {}

  findAllAgencies() {
    return this.agencyModel.find().sort({ name: 1 }).lean();
  }

  async findAgencyById(id: string) {
    const agency = await this.agencyModel.findById(id).lean();
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }
    return agency;
  }

  async createAgency(input: { name: string; slug: string }) {
    const modules = Object.fromEntries(
      ALL_MODULE_KEYS.map((key) => [
        key,
        {
          enabled: [
            ModuleKey.Dashboard,
            ModuleKey.Management,
            ModuleKey.OwnerDashboard,
            ModuleKey.Leads,
            ModuleKey.Clients,
            ModuleKey.Performance,
          ].includes(key),
        },
      ]),
    );

    const agency = await this.agencyModel.create({
      name: input.name,
      slug: input.slug,
      modules,
    });

    await this.roleAssignments.seedDefaultRoles(agency._id);
    return agency;
  }

  async updateModuleEntitlements(
    agencyId: string,
    modules: Record<string, { enabled: boolean }>,
    enabledBy: string,
  ) {
    const agency = await this.agencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    for (const [key, value] of Object.entries(modules)) {
      agency.modules[key] = value.enabled
        ? { enabled: true, enabledAt: new Date(), enabledBy }
        : { enabled: false };
    }

    agency.markModified('modules');
    await agency.save();

    // Enabled-module changes alter every user's effective permission set (perms
    // are filtered to enabled modules), so invalidate the whole agency.
    await this.accessResolver.invalidateAgency(agencyId);

    return agency.toObject();
  }
}
