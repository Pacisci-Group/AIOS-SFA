import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AgencyPermission } from '@sfa/shared';
import {
  Public,
  RequirePermissions,
  SkipBranch,
  SkipModule,
} from '../common/decorators/access.decorators';
import { AgencyId } from '../common/decorators/user.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AgencyDomainsService } from './agency-domains.service';
import {
  createAgencyDomainSchema,
  type CreateAgencyDomainDto,
} from './dto/agency-domain.dto';

/**
 * Agency-owner self-serve domain management.
 *
 * `@SkipModule` because domains are not a product module an agency can have
 * switched off — they are how the agency reaches the product at all. The gate
 * is the `agency:domains:*` permission, which only the Agency Owner holds by
 * default.
 *
 * `@SkipBranch` for the same reason branches are skipped on `BranchesController`:
 * a domain belongs to the agency, not to one of its offices.
 */
@Controller('agency/domains')
@SkipModule()
@SkipBranch()
@UseGuards(PermissionsGuard)
export class AgencyDomainsController {
  constructor(private readonly domains: AgencyDomainsService) {}

  @Get()
  @RequirePermissions(AgencyPermission.DomainsRead)
  list(@AgencyId() agencyId: string) {
    return this.domains.list(agencyId);
  }

  @Post()
  @RequirePermissions(AgencyPermission.DomainsWrite)
  create(
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(createAgencyDomainSchema))
    body: CreateAgencyDomainDto,
  ) {
    return this.domains.create(agencyId, body);
  }

  @Post(':domainId/verify')
  @HttpCode(200)
  @RequirePermissions(AgencyPermission.DomainsWrite)
  verify(@AgencyId() agencyId: string, @Param('domainId') domainId: string) {
    return this.domains.verify(agencyId, domainId);
  }

  @Patch(':domainId/primary')
  @RequirePermissions(AgencyPermission.DomainsWrite)
  setPrimary(
    @AgencyId() agencyId: string,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.setPrimary(agencyId, domainId);
  }

  @Delete(':domainId')
  @HttpCode(204)
  async remove(
    @AgencyId() agencyId: string,
    @Param('domainId') domainId: string,
  ): Promise<void> {
    await this.domains.remove(agencyId, domainId);
  }
}

/**
 * Caddy's on-demand-TLS `ask` endpoint.
 *
 * Caddy calls this **before** requesting a certificate for a hostname it has
 * never seen. `200` means "go ahead"; anything else means "refuse the
 * connection". It is the only thing standing between a public IP on port 443
 * and an attacker making us request certificates for arbitrary domains until
 * Let's Encrypt rate-limits our whole account.
 *
 * Split into its own controller because it is `@Public()` and lives under a
 * different path prefix; keeping it on the authenticated controller above would
 * mean one `@Public()` route sitting in a class whose every other route is
 * permission-gated, which is exactly how a `@Public()` gets copied onto the
 * wrong handler later.
 *
 * ⚠ Do not add a response body. Caddy reads the status code only, and anything
 * here would be an unauthenticated disclosure of which domains we serve.
 */
@Controller('public/domains')
export class PublicDomainsController {
  constructor(private readonly domains: AgencyDomainsService) {}

  @Public()
  @Get('allow')
  @HttpCode(200)
  async allow(@Query('domain') domain?: string): Promise<void> {
    const allowed = await this.domains.isCertificateAllowed(domain);
    if (!allowed) {
      throw new NotFoundException();
    }
  }
}
