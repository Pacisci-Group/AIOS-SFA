import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AccessContext,
  AgencyPermission,
  ModuleKey,
  type PolicyPeopleResponse,
  type HrPoliciesResponse,
  type HrPolicyView,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createHrPolicySchema,
  enrolMemberSchema,
  listHrPoliciesQuerySchema,
  policyIdParamSchema,
  updateHrPolicySchema,
  userIdParamSchema,
  type CreateHrPolicyDto,
  type EnrolMemberDto,
  type ListHrPoliciesQueryDto,
  type UpdateHrPolicyDto,
} from './dto/hr-policy.dto';
import { HrPoliciesService } from './hr-policies.service';

/**
 * HR policies (PAC-161 v3, PAC-174) — Workspace Settings → HR policies.
 *
 * Every route is `agency:hr:admin`: an admin capability, not the module's
 * `:write`, which is the *reviewer* capability over other people's requests
 * (PAC-165). An employee reading their own holidays and hours arrives with
 * that ticket.
 *
 * `@SkipBranch()` — a policy belongs to the agency; nothing is per branch.
 */
@Controller('hr/policies')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
export class HrPoliciesController {
  constructor(private readonly policies: HrPoliciesService) {}

  /** Active policies, optionally of one type, plus the count of each type. */
  @Get()
  @RequirePermissions(AgencyPermission.HrAdmin)
  list(
    @AgencyId() agencyId: string,
    @Query(new ZodValidationPipe(listHrPoliciesQuerySchema))
    query: ListHrPoliciesQueryDto,
  ): Promise<HrPoliciesResponse> {
    return this.policies.list(agencyId, query.type);
  }

  /** The people a policy can enrol. Declared before `:policyId`. */
  @Get('people')
  @RequirePermissions(AgencyPermission.HrAdmin)
  people(@AgencyId() agencyId: string): Promise<PolicyPeopleResponse> {
    return this.policies.people(agencyId);
  }

  @Get(':policyId')
  @RequirePermissions(AgencyPermission.HrAdmin)
  get(
    @AgencyId() agencyId: string,
    @Param('policyId', new ZodValidationPipe(policyIdParamSchema))
    policyId: string,
  ): Promise<HrPolicyView> {
    return this.policies.get(agencyId, policyId);
  }

  /**
   * Enrolling someone moves them out of their other policy of the kind. A
   * time off policy is active from here: its starting balances are posted,
   * dated today on the agency's calendar (`access.timeZone`).
   */
  @Post()
  @RequirePermissions(AgencyPermission.HrAdmin)
  create(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(createHrPolicySchema))
    body: CreateHrPolicyDto,
  ): Promise<HrPolicyView> {
    return this.policies.create(agencyId, body, access.timeZone);
  }

  /** Time off: paid/unpaid and Unlimited are locked — 400 on a change. */
  @Patch(':policyId')
  @RequirePermissions(AgencyPermission.HrAdmin)
  update(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('policyId', new ZodValidationPipe(policyIdParamSchema))
    policyId: string,
    @Body(new ZodValidationPipe(updateHrPolicySchema))
    body: UpdateHrPolicyDto,
  ): Promise<HrPolicyView> {
    return this.policies.update(agencyId, policyId, body, access.timeZone);
  }

  /**
   * Enrol one person (PAC-162) — the same move / balance rules as a member
   * list save. Returns the policy. 400 with a balance on a non-time-off
   * policy or for someone already in it.
   */
  @Post(':policyId/members')
  @RequirePermissions(AgencyPermission.HrAdmin)
  enrol(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('policyId', new ZodValidationPipe(policyIdParamSchema))
    policyId: string,
    @Body(new ZodValidationPipe(enrolMemberSchema)) body: EnrolMemberDto,
  ): Promise<HrPolicyView> {
    return this.policies.enrol(
      agencyId,
      policyId,
      body.userId,
      body.startingBalanceHours,
      access.timeZone,
    );
  }

  /** Take one person out (PAC-162). 404 when they are not a member. */
  @Delete(':policyId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(AgencyPermission.HrAdmin)
  unenrol(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('policyId', new ZodValidationPipe(policyIdParamSchema))
    policyId: string,
    @Param('userId', new ZodValidationPipe(userIdParamSchema))
    userId: string,
  ): Promise<void> {
    return this.policies.unenrol(agencyId, policyId, userId, access.timeZone);
  }

  /**
   * Soft archive; a second call is a 404. A time off policy with a request
   * waiting for a decision is a 409 — decide it first.
   */
  @Post(':policyId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(AgencyPermission.HrAdmin)
  archive(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('policyId', new ZodValidationPipe(policyIdParamSchema))
    policyId: string,
  ): Promise<void> {
    return this.policies.archive(agencyId, policyId, access.userId);
  }
}
