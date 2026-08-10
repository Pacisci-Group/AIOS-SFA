import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createShareLinkSchema } from './dto/create-share-link.dto';
import type { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareLinksService } from './share-links.service';

/**
 * Producer-managed public intake links (PAC-37).
 *
 * Mounted under `leads/` and gated by the `leads` module so a link inherits
 * exactly the entitlement of the thing it creates.
 */
@Controller('leads/share-links')
@RequireModule(ModuleKey.Leads)
@RequirePermissions(modulePermission(ModuleKey.Leads, 'read'))
export class ShareLinksController {
  constructor(private readonly shareLinksService: ShareLinksService) {}

  /** Generate a link for the caller. */
  @Post()
  @RequireWrite(ModuleKey.Leads)
  create(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(createShareLinkSchema))
    body: CreateShareLinkDto,
  ) {
    return this.shareLinksService.create(access, branchId, body);
  }

  /** The caller's own links, with submission counts. */
  @Get()
  list(@Access() access: AccessContext) {
    return this.shareLinksService.list(access);
  }

  /** Deactivate a link. Idempotent. */
  @Patch(':id/revoke')
  @RequireWrite(ModuleKey.Leads)
  revoke(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id') id: string,
  ) {
    return this.shareLinksService.revoke(access, branchId, id);
  }
}
