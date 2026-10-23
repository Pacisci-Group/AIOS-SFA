import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleKey } from '@sfa/shared';
import { Model } from 'mongoose';
import { EmployeeProfilesService } from '../common/hr/employee-profiles.service';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { Agency, AgencyDocument } from './schemas/agency.schema';

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    @InjectModel(Agency.name) private agencyModel: Model<AgencyDocument>,
    private accessResolver: AccessResolverService,
    private employeeProfiles: EmployeeProfilesService,
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

  async updateModuleEntitlements(
    agencyId: string,
    modules: Record<string, { enabled: boolean }>,
    enabledBy: string,
  ) {
    const agency = await this.agencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    const hrWasEnabled = agency.modules[ModuleKey.Hr]?.enabled === true;
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

    /*
     * Switching HR on for an existing agency gives every active user a
     * pending profile (PAC-162), so the Onboardings list is populated the
     * moment an admin opens it — the same catch-up the `employee_profiles`
     * migration ran for the agencies that existed when HR shipped.
     */
    if (!hrWasEnabled && agency.modules[ModuleKey.Hr]?.enabled === true) {
      const created = await this.employeeProfiles.ensureProfilesForAgency(
        agencyId,
      );
      if (created > 0) {
        this.logger.log(
          `HR enabled on ${agencyId}: ${created} pending employee profile(s) created`,
        );
      }
    }

    return agency.toObject();
  }
}
