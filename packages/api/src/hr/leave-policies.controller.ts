import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type AccessContext,
  AgencyPermission,
  type LeavePoliciesResponse,
  type LeavePolicyView,
  ModuleKey,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createLeavePolicySchema,
  leavePolicyIdSchema,
  updateLeavePolicySchema,
  type CreateLeavePolicyDto,
  type UpdateLeavePolicyDto,
} from './dto/leave-policy.dto';
import { LeavePoliciesService } from './leave-policies.service';

/**
 * Leave policies (PAC-161) — `agency:hr:admin` throughout. An employee sees
 * their *own* effective rules through their profile (PAC-162), never the
 * agency's policy list.
 */
@Controller('hr/leave-policies')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
@RequirePermissions(AgencyPermission.HrAdmin)
export class LeavePoliciesController {
  constructor(private readonly policies: LeavePoliciesService) {}

  /** Active first, then archived. An empty list is normal. */
  @Get()
  list(@AgencyId() agencyId: string): Promise<LeavePoliciesResponse> {
    return this.policies.list(agencyId);
  }

  /** A name and any rules that differ from the defaults. 409 on a duplicate name. */
  @Post()
  create(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(createLeavePolicySchema))
    body: CreateLeavePolicyDto,
  ): Promise<LeavePolicyView> {
    return this.policies.create(access, agencyId, body);
  }

  @Get(':id')
  get(
    @AgencyId() agencyId: string,
    @Param('id', new ZodValidationPipe(leavePolicyIdSchema)) id: string,
  ): Promise<LeavePolicyView> {
    return this.policies.get(agencyId, id);
  }

  /** A partial patch, arrays whole; bumps `version`. 400 names every inconsistency. */
  @Patch(':id')
  update(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('id', new ZodValidationPipe(leavePolicyIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateLeavePolicySchema))
    body: UpdateLeavePolicyDto,
  ): Promise<LeavePolicyView> {
    return this.policies.update(access, agencyId, id, body);
  }

  /** 409 while employees are on it; the last policy may be archived. */
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('id', new ZodValidationPipe(leavePolicyIdSchema)) id: string,
  ): Promise<LeavePolicyView> {
    return this.policies.archive(access, agencyId, id);
  }
}
