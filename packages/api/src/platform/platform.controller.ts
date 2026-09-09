import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformPermission } from '@sfa/shared';
import { CurrentUser } from '../common/decorators/user.decorators';
import {
  RequirePermissions,
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AgencyProvisioningService } from './agency-provisioning.service';
import {
  agencyAvailabilitySchema,
  onboardAgencySchema,
  type AgencyAvailabilityQueryDto,
  type OnboardAgencyDto,
} from './dto/onboard-agency.dto';
import { PlatformService } from './platform.service';

@Controller('platform/agencies')
@SkipTenant()
@SkipBranch()
@SkipModule()
@UseGuards(PermissionsGuard)
export class PlatformController {
  constructor(
    private platformService: PlatformService,
    private provisioning: AgencyProvisioningService,
  ) {}

  @Get()
  @RequirePermissions(PlatformPermission.AgenciesRead)
  listAgencies() {
    return this.platformService.findAllAgencies();
  }

  /**
   * ⚠ **Must stay above `GET :agencyId`.** Nest matches in declaration order, so
   * below it this path would bind `agencyId = 'availability'` and hand a
   * non-ObjectId to `findById`. The same hazard is annotated on the Policies,
   * Share Links and Clients modules in `app.module.ts`.
   */
  @Get('availability')
  @RequirePermissions(PlatformPermission.AgenciesRead)
  checkAvailability(
    @Query(new ZodValidationPipe(agencyAvailabilitySchema))
    query: AgencyAvailabilityQueryDto,
  ) {
    return this.provisioning.checkAvailability(query);
  }

  @Get(':agencyId')
  @RequirePermissions(PlatformPermission.AgenciesRead)
  getAgency(@Param('agencyId') agencyId: string) {
    return this.platformService.findAgencyById(agencyId);
  }

  /**
   * Onboard a whole tenant: agency, roles, first branch, audit checklist and an
   * invited owner (PAC-69).
   *
   * This used to create the agency document and nothing else, which produced a
   * tenant nobody could sign into and no record could be written to. See
   * {@link AgencyProvisioningService} for the rollback rules and for why the
   * owner's invite email is dispatched after the point of no return.
   */
  @Post()
  @RequirePermissions(PlatformPermission.AgenciesWrite)
  onboardAgency(
    @Body(new ZodValidationPipe(onboardAgencySchema)) body: OnboardAgencyDto,
    @CurrentUser() user: { sub: string },
  ) {
    return this.provisioning.onboard(body, { userId: user.sub });
  }

  /**
   * Resend the owner's invite — the recovery path when the onboarding response
   * came back with `emailStatus: 'failed'`, or when the link expired unused.
   *
   * `200`, not `201`: nothing is created. A platform operator cannot use the
   * tenant-side `POST /users/:userId/invite/resend`, which is gated on
   * `agency:users:write` — a permission no platform account holds.
   */
  @Post(':agencyId/owner-invite/resend')
  @HttpCode(200)
  @RequirePermissions(PlatformPermission.AgenciesWrite)
  resendOwnerInvite(@Param('agencyId') agencyId: string) {
    return this.provisioning.resendOwnerInvite(agencyId);
  }

  @Patch(':agencyId/modules')
  @RequirePermissions(PlatformPermission.ModulesToggle)
  updateModules(
    @Param('agencyId') agencyId: string,
    @Body() body: { modules: Record<string, { enabled: boolean }> },
    @CurrentUser() user: { sub: string },
  ) {
    return this.platformService.updateModuleEntitlements(
      agencyId,
      body.modules,
      user.sub,
    );
  }
}
