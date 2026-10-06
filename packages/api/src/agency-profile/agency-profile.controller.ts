import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AgencyPermission } from '@sfa/shared';
import {
  RequirePermissions,
  SkipBranch,
  SkipModule,
} from '../common/decorators/access.decorators';
import { AgencyId } from '../common/decorators/user.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AgencyProfileService } from './agency-profile.service';
import {
  updateAgencyProfileSchema,
  type UpdateAgencyProfileDto,
} from './dto/agency-profile.dto';

/**
 * The agency's own profile — its working day: the time zone (PAC-141) and the
 * hour everyone is set Away (PAC-149).
 *
 * Gated on its own pair, `agency:settings:read` / `:write`. PAC-141 reused
 * the branding pair for the zone alone, on the `AgencySetupController`
 * precedent; with the end-of-day hour beside it the page now does something
 * to every user every night, and the role matrix would have shown an owner
 * delegating "branding" nothing to say they were also handing over that
 * clock. By default the Agency Owner holds the pair and nobody else does —
 * existing owners got it from the `agency_settings_permission_grant`
 * migration (see `AgencyPermission.SettingsRead`).
 *
 * Platform accounts hold no `agency:*` permission, so after onboarding a super
 * admin changes either field the way they change anything tenant-side: by
 * impersonating the owner (PAC-70).
 *
 * `@SkipModule` because the agency's identity is not a product module that
 * can be switched off.
 */
@Controller('agency/profile')
@SkipModule()
@SkipBranch()
@UseGuards(PermissionsGuard)
export class AgencyProfileController {
  constructor(private readonly profile: AgencyProfileService) {}

  @Get()
  @RequirePermissions(AgencyPermission.SettingsRead)
  get(@AgencyId() agencyId: string) {
    return this.profile.get(agencyId);
  }

  @Patch()
  @RequirePermissions(AgencyPermission.SettingsWrite)
  update(
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(updateAgencyProfileSchema))
    body: UpdateAgencyProfileDto,
  ) {
    return this.profile.update(agencyId, body);
  }
}
