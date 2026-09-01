import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AgencyPermission } from '@sfa/shared';
import {
  Public,
  RequirePermissions,
  SkipBranch,
  SkipModule,
} from '../common/decorators/access.decorators';
import { AgencyId, HostTenant } from '../common/decorators/user.decorators';
import type { HostTenant as ResolvedHostTenant } from '../common/tenancy/host-tenant.resolver';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { StorageService } from '../storage/storage.service';
import { AgencyBrandingService } from './agency-branding.service';
import {
  brandingUploadSchema,
  updateBrandingSchema,
  type BrandingUploadDto,
  type UpdateBrandingDto,
} from './dto/branding.dto';
import {
  TenantBrandingService,
  type LogoVariant,
} from './tenant-branding.service';

/**
 * How the web app finds out whose product it is.
 *
 * Every route is `@Public()` and resolves its tenant from the request's own
 * `Host` — which is the whole point: the login page has to be branded *before*
 * anyone has signed in, so none of this can depend on a session.
 *
 * ## What it is safe to expose
 * Only what a visitor to that hostname can already see by looking at the page:
 * a name, a tagline, and an image. No agency id is useful without credentials,
 * no user data appears here, and an unknown host gets the same `404` as
 * everywhere else so this cannot be used to enumerate tenants.
 */
@Controller('public/tenant')
export class TenantBootstrapController {
  constructor(
    private readonly branding: TenantBrandingService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  bootstrap(@HostTenant() host: ResolvedHostTenant) {
    return this.branding.forHost(host);
  }

  /**
   * The agency's logo bytes, streamed from object storage.
   *
   * Streamed rather than redirected to a presigned URL, for three reasons that
   * are written up on `logoPath` in the service — the short version is that a
   * presigned URL would need every tenant domain in the Spaces CORS list and
   * would be uncacheable.
   *
   * `Cache-Control` is deliberately long and public. This is the one endpoint
   * an email client fetches, once per recipient, from an IP we do not control;
   * without caching, a hundred-recipient send is a hundred storage reads. The
   * cost of the long TTL is that a replaced logo can take an hour to turn over
   * in a cached client — the URL carries a `variant`, not a content hash, so
   * the SPA appends its own cache-buster when it knows the logo just changed.
   */
  @Public()
  @Get('logo')
  @Header('Cache-Control', 'public, max-age=3600')
  async logo(
    @HostTenant() host: ResolvedHostTenant,
    @Res() res: Response,
    @Query('variant') variant?: string,
  ): Promise<void> {
    if (host?.kind !== 'agency') {
      // The platform mark is a bundled asset in the web app, not an upload.
      throw new NotFoundException();
    }

    const wanted: LogoVariant = variant === 'dark' ? 'dark' : 'light';
    const key = await this.branding.logoKeyFor(host.agencyId, wanted);
    if (!key) {
      throw new NotFoundException();
    }

    await this.stream(key, res);
  }

  @Public()
  @Get('favicon')
  @Header('Cache-Control', 'public, max-age=3600')
  async favicon(
    @HostTenant() host: ResolvedHostTenant,
    @Res() res: Response,
  ): Promise<void> {
    if (host?.kind !== 'agency') {
      throw new NotFoundException();
    }
    const key = await this.branding.faviconKeyFor(host.agencyId);
    if (!key) {
      throw new NotFoundException();
    }
    await this.stream(key, res);
  }

  private async stream(key: string, res: Response): Promise<void> {
    const stat = await this.storage.statObject(key);
    const stream = await this.storage.getObjectStream(key);

    // The stored content type, never a guess from the key's extension — the
    // extension is attacker-influenced (it comes from the uploaded filename)
    // and the stored type was validated on commit.
    res.setHeader(
      'Content-Type',
      stat?.contentType ?? 'application/octet-stream',
    );
    if (stat?.size) {
      res.setHeader('Content-Length', stat.size);
    }
    // Belt and braces against a bad content type ever reaching a browser: with
    // sniffing off, a mislabelled file renders as nothing rather than as markup.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    stream.pipe(res);
  }
}

/**
 * Agency-owner branding settings.
 *
 * `@SkipModule` for the same reason as domains: branding is not a product
 * module that can be switched off, it is what the product is called. The
 * `agency:branding:*` permission is the gate.
 */
@Controller('agency/branding')
@SkipModule()
@SkipBranch()
@UseGuards(PermissionsGuard)
export class AgencyBrandingController {
  constructor(private readonly branding: AgencyBrandingService) {}

  @Get()
  @RequirePermissions(AgencyPermission.BrandingRead)
  get(@AgencyId() agencyId: string) {
    return this.branding.get(agencyId);
  }

  @Post('uploads')
  @RequirePermissions(AgencyPermission.BrandingWrite)
  presignUpload(
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(brandingUploadSchema))
    body: BrandingUploadDto,
  ) {
    return this.branding.presignUpload(agencyId, body);
  }

  @Patch()
  @RequirePermissions(AgencyPermission.BrandingWrite)
  update(
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(updateBrandingSchema))
    body: UpdateBrandingDto,
  ) {
    return this.branding.update(agencyId, body);
  }
}
