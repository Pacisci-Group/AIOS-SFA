import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { PlatformService } from './platform.service';

@Controller('platform/agencies')
@SkipTenant()
@SkipBranch()
@SkipModule()
@UseGuards(PermissionsGuard)
export class PlatformController {
  constructor(private platformService: PlatformService) {}

  @Get()
  @RequirePermissions(PlatformPermission.AgenciesRead)
  listAgencies() {
    return this.platformService.findAllAgencies();
  }

  @Get(':agencyId')
  @RequirePermissions(PlatformPermission.AgenciesRead)
  getAgency(@Param('agencyId') agencyId: string) {
    return this.platformService.findAgencyById(agencyId);
  }

  @Post()
  @RequirePermissions(PlatformPermission.AgenciesWrite)
  createAgency(@Body() body: { name: string; slug: string }) {
    return this.platformService.createAgency(body);
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
