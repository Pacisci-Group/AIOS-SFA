import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AgencyPermission } from '@sfa/shared';
import {
  RequirePermissions,
  SkipBranch,
  SkipModule,
} from '../common/decorators/access.decorators';
import { AgencyId } from '../common/decorators/user.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AgencyEmailService } from './agency-email.service';
import {
  setSendingDomainSchema,
  updateAgencyEmailSchema,
  type SetSendingDomainDto,
  type UpdateAgencyEmailDto,
} from './dto/agency-email.dto';

/**
 * Agency-owner control over how their outbound email is addressed.
 *
 * `@SkipModule` for the same reason as domains and branding: email identity is
 * not a product module that can be switched off. `agency:email:*` is the gate,
 * and it is separate from the other two because the blast radius is different —
 * a bad sender address stops every invite arriving.
 */
@Controller('agency/email')
@SkipModule()
@SkipBranch()
@UseGuards(PermissionsGuard)
export class AgencyEmailController {
  constructor(private readonly email: AgencyEmailService) {}

  @Get()
  @RequirePermissions(AgencyPermission.EmailRead)
  get(@AgencyId() agencyId: string) {
    return this.email.get(agencyId);
  }

  @Patch()
  @RequirePermissions(AgencyPermission.EmailWrite)
  update(
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(updateAgencyEmailSchema))
    body: UpdateAgencyEmailDto,
  ) {
    return this.email.update(agencyId, body);
  }

  @Post('sending-domain')
  @RequirePermissions(AgencyPermission.EmailWrite)
  setSendingDomain(
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(setSendingDomainSchema))
    body: SetSendingDomainDto,
  ) {
    return this.email.setSendingDomain(agencyId, body);
  }

  @Post('sending-domain/verify')
  @HttpCode(200)
  @RequirePermissions(AgencyPermission.EmailWrite)
  verifySendingDomain(@AgencyId() agencyId: string) {
    return this.email.verifySendingDomain(agencyId);
  }

  /** Fall back to the platform sender. See the service — this is the fix-it. */
  @Delete('sending-domain')
  @RequirePermissions(AgencyPermission.EmailWrite)
  clearSendingDomain(@AgencyId() agencyId: string) {
    return this.email.clearSendingDomain(agencyId);
  }
}
