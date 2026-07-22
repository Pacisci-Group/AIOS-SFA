import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AgencyPermission } from '@sfa/shared';
import { AgencyId } from '../common/decorators/user.decorators';
import {
  RequirePermissions,
  SkipModule,
} from '../common/decorators/access.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { BranchesService } from './branches.service';

@Controller('branches')
@SkipModule()
@UseGuards(PermissionsGuard)
export class BranchesController {
  constructor(private branchesService: BranchesService) {}

  @Get()
  @RequirePermissions(AgencyPermission.BranchesRead)
  list(@AgencyId() agencyId: string) {
    return this.branchesService.findByAgency(agencyId);
  }

  @Get(':branchId')
  @RequirePermissions(AgencyPermission.BranchesRead)
  getOne(@AgencyId() agencyId: string, @Param('branchId') branchId: string) {
    return this.branchesService.findById(agencyId, branchId);
  }

  @Post()
  @RequirePermissions(AgencyPermission.BranchesWrite)
  create(
    @AgencyId() agencyId: string,
    @Body() body: { name: string; slug: string; isDefault?: boolean },
  ) {
    return this.branchesService.create(agencyId, body);
  }
}
