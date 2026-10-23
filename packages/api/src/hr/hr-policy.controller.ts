import { Controller, Get } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AgencyPermission, type HrPolicyView, ModuleKey } from '@sfa/shared';
import { Model } from 'mongoose';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { AgencyId } from '../common/decorators/user.decorators';
import { LeavePolicyService } from '../common/hr/leave-policy.service';
import { Agency } from '../platform/schemas/agency.schema';

/**
 * The "HR Policy" — assembled, never stored (PAC-161; Asad, 2026-10-22).
 * Reads the setup flag off the agency and the active policy count, and
 * renders the two reserved slots PAC-123 will fill.
 */
@Controller('hr/policy')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
export class HrPolicyController {
  constructor(
    @InjectModel(Agency.name) private readonly agencies: Model<Agency>,
    private readonly leavePolicies: LeavePolicyService,
  ) {}

  @Get()
  @RequirePermissions(AgencyPermission.HrAdmin)
  async view(@AgencyId() agencyId: string): Promise<HrPolicyView> {
    const [agency, activePolicyCount] = await Promise.all([
      this.agencies
        .findById(agencyId)
        .select('setup')
        .lean<{ setup?: { hrPolicySkipped?: boolean } } | null>(),
      this.leavePolicies.activeCount(agencyId),
    ]);
    return {
      leaveAndAttendance: {
        status:
          activePolicyCount > 0
            ? 'configured'
            : agency?.setup?.hrPolicySkipped
              ? 'skipped'
              : 'none',
        activePolicyCount,
      },
      compensation: { status: 'reserved' },
      employeeHandbook: { status: 'reserved' },
    };
  }
}
