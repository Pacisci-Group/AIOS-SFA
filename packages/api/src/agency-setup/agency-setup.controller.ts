import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AgencyPermission } from '@sfa/shared';
import {
  RequirePermissions,
  SkipBranch,
  SkipModule,
} from '../common/decorators/access.decorators';
import { AgencyId, CurrentUser } from '../common/decorators/user.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AgencySetupService } from './agency-setup.service';
import {
  completeAgencySetupSchema,
  type CompleteAgencySetupDto,
} from './dto/agency-setup.dto';

/**
 * First-run setup state for the agency's own owner (PAC-69).
 *
 * Same decorator stack and same permission as `agency/branding`, which is not a
 * coincidence: this endpoint exists to gate a wizard whose only writes *are*
 * branding and sender-identity writes, so anyone allowed to do those is allowed
 * to say they are finished. Inventing an `agency:setup:*` permission would mean
 * granting it to every existing owner role before the feature worked for anyone
 * — the same argument PAC-79 made for reusing `agency:users:write`.
 *
 * `@SkipModule` because setup is not a product module that can be switched off.
 */
@Controller('agency/setup')
@SkipModule()
@SkipBranch()
@UseGuards(PermissionsGuard)
export class AgencySetupController {
  constructor(private readonly setup: AgencySetupService) {}

  @Get()
  @RequirePermissions(AgencyPermission.BrandingRead)
  get(@AgencyId() agencyId: string) {
    return this.setup.get(agencyId);
  }

  /** `200`, not `201` — this updates a sub-document, it creates nothing. */
  @Post('complete')
  @HttpCode(200)
  @RequirePermissions(AgencyPermission.BrandingWrite)
  complete(
    @AgencyId() agencyId: string,
    @CurrentUser() user: { sub: string },
    @Body(new ZodValidationPipe(completeAgencySetupSchema))
    body: CompleteAgencySetupDto,
  ) {
    return this.setup.complete(agencyId, user.sub, body);
  }
}
