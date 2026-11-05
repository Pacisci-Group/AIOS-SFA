import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import {
  type AccessContext,
  AgencyPermission,
  type BalanceAdjustmentResult,
  ModuleKey,
  type PersonProfileView,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  balanceAdjustmentSchema,
  completeOnboardingSchema,
  personIdParamSchema,
  updatePersonFactsSchema,
  type BalanceAdjustmentDto,
  type CompleteOnboardingDto,
  type UpdatePersonFactsDto,
} from './dto/people.dto';
import { PeopleService } from './people.service';

/**
 * The HR writes on a person (PAC-162) — the People profile's Edit details
 * and Complete onboarding. Reading a profile is `GET /users/:userId/profile`
 * (anyone may read their own, which is not an HR capability), and the
 * policy enrolment routes sit with the policies (`/hr/policies/:id/members`).
 *
 * Every route is `agency:hr:admin`: the Branch Manager (the Office Manager)
 * and the owner. `@SkipBranch()` — HR facts belong to the agency.
 */
@Controller('hr/people')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  /**
   * Edit the facts: name halves, phone, hire date, date of birth, show
   * birthday. 400 on a hire date in the future (agency calendar), a date of
   * birth not in the past, or clearing the hire date of an active employee.
   */
  @Patch(':userId')
  @RequirePermissions(AgencyPermission.HrAdmin)
  updateFacts(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('userId', new ZodValidationPipe(personIdParamSchema))
    userId: string,
    @Body(new ZodValidationPipe(updatePersonFactsSchema))
    body: UpdatePersonFactsDto,
  ): Promise<PersonProfileView> {
    return this.people.updateFacts(access, agencyId, userId, body);
  }

  /**
   * Pending → Active: the hire date, optional facts, and the policies to
   * enrol in (a starting balance per time off policy). 409 when already
   * complete or when the person has been removed. Allowed before the
   * invite is accepted — the list keeps saying Invited until then.
   */
  @Post(':userId/onboarding/complete')
  @RequirePermissions(AgencyPermission.HrAdmin)
  completeOnboarding(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('userId', new ZodValidationPipe(personIdParamSchema))
    userId: string,
    @Body(new ZodValidationPipe(completeOnboardingSchema))
    body: CompleteOnboardingDto,
  ): Promise<PersonProfileView> {
    return this.people.completeOnboarding(access, agencyId, userId, body);
  }

  /**
   * Adjust one person's balance in one time off policy by hand (PAC-165):
   * signed hours and a reason, posted as a `manual_adjustment` ledger row
   * dated today. The employee is told. 400 on an Unlimited policy (it has
   * no balance) or a person who is not in the policy.
   */
  @Post(':userId/balance-adjustments')
  @RequirePermissions(AgencyPermission.HrAdmin)
  adjustBalance(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('userId', new ZodValidationPipe(personIdParamSchema))
    userId: string,
    @Body(new ZodValidationPipe(balanceAdjustmentSchema))
    body: BalanceAdjustmentDto,
  ): Promise<BalanceAdjustmentResult> {
    return this.people.adjustBalance(access, agencyId, userId, body);
  }
}
