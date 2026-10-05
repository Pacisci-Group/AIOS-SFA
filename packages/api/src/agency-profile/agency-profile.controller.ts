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
 * The agency's own profile — its time zone (PAC-141).
 *
 * Same decorator stack and the same permission as `agency/branding`, for the
 * reason `AgencySetupController` gives: the permission vocabulary is a fixed
 * contract, a new `agency:profile:*` pair would reach existing owners only
 * after `api:sync:roles` on every environment (the PAC-133 lock-out), and the
 * people who may rename the agency are the people who may say where it is.
 * The branding permission is, in practice, "may edit the agency's identity".
 *
 * Platform accounts hold no `agency:*` permission, so after onboarding a super
 * admin changes a zone the way they change anything tenant-side: by
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
  @RequirePermissions(AgencyPermission.BrandingRead)
  get(@AgencyId() agencyId: string) {
    return this.profile.get(agencyId);
  }

  @Patch()
  @RequirePermissions(AgencyPermission.BrandingWrite)
  update(
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(updateAgencyProfileSchema))
    body: UpdateAgencyProfileDto,
  ) {
    return this.profile.update(agencyId, body);
  }
}
