import { Body, Controller, Post } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ActivitiesService } from './activities.service';
import { createActivitySchema } from './dto/create-activity.dto';
import type { CreateActivityDto } from './dto/create-activity.dto';

/**
 * Activity logging (PAC-16) — the write behind the dashboard's lead quick
 * actions and the Lead Detail note composer.
 *
 * Gated by the **`leads`** module rather than one of its own: logging a touch
 * on a lead is a lead write. The Producer role already holds `leads:write` and
 * a read-only role does not, so the existing vocabulary says exactly the right
 * thing and a new `ModuleKey` would only add a gate nobody grants.
 */
@Controller('activities')
@RequireModule(ModuleKey.Leads)
@RequirePermissions(modulePermission(ModuleKey.Leads, 'read'))
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post()
  @RequireWrite(ModuleKey.Leads)
  create(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(createActivitySchema)) body: CreateActivityDto,
  ) {
    
    return this.activitiesService.create(access, branchId, body);
  }
}
