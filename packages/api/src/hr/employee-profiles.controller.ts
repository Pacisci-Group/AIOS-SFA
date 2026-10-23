import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type AccessContext,
  AgencyPermission,
  type EmployeeListResponse,
  type EmployeeProfileView,
  ModuleKey,
  modulePermission,
  type MyHrProfileView,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  activateEmployeeSchema,
  employeeUserIdSchema,
  listEmployeesSchema,
  setEmployeeAssignmentSchema,
  terminateEmployeeSchema,
  updateEmployeeFactsSchema,
  updateMyHrProfileSchema,
  type ActivateEmployeeDto,
  type ListEmployeesDto,
  type SetEmployeeAssignmentDto,
  type TerminateEmployeeDto,
  type UpdateEmployeeFactsDto,
  type UpdateMyHrProfileDto,
} from './dto/employee-profile.dto';
import { EmployeeProfilesService } from './employee-profiles.service';

/**
 * Employee profiles — the admin side (PAC-162): the Onboardings and
 * Employees lists, one person's record, and the four writes. All
 * `agency:hr:admin`; a reviewer (`hr:write`) sees none of this, and an
 * employee sees their own record through {@link MyHrProfileController}.
 *
 * Addressed by **user id**, not profile id: the user is what every other
 * screen links to, and there is exactly one profile per user per agency.
 *
 * `@SkipBranch()` — profiles are agency-level; the branch is the user's.
 */
@Controller('hr/employees')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
@RequirePermissions(AgencyPermission.HrAdmin)
export class EmployeeProfilesController {
  constructor(private readonly profiles: EmployeeProfilesService) {}

  /** The Employees list; `?status=pending` is the Onboardings list. Never returns a date of birth. */
  @Get()
  list(
    @AgencyId() agencyId: string,
    @Query(new ZodValidationPipe(listEmployeesSchema)) query: ListEmployeesDto,
  ): Promise<EmployeeListResponse> {
    return this.profiles.list(agencyId, query);
  }

  @Get(':userId')
  get(
    @AgencyId() agencyId: string,
    @Param('userId', new ZodValidationPipe(employeeUserIdSchema)) userId: string,
  ): Promise<EmployeeProfileView> {
    return this.profiles.view(agencyId, userId);
  }

  /** `pending → active`, or `terminated → active` (rehire). 409 when already active. */
  @Post(':userId/activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('userId', new ZodValidationPipe(employeeUserIdSchema)) userId: string,
    @Body(new ZodValidationPipe(activateEmployeeSchema))
    body: ActivateEmployeeDto,
  ): Promise<EmployeeProfileView> {
    return this.profiles.activate(access, agencyId, userId, body);
  }

  /** A new history entry on an active profile. 409 while pending or terminated. */
  @Put(':userId/assignment')
  setAssignment(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('userId', new ZodValidationPipe(employeeUserIdSchema)) userId: string,
    @Body(new ZodValidationPipe(setEmployeeAssignmentSchema))
    body: SetEmployeeAssignmentDto,
  ): Promise<EmployeeProfileView> {
    return this.profiles.setAssignment(access, agencyId, userId, body);
  }

  /** Facts only — hire date, anniversary, birthday. Never rules. */
  @Patch(':userId')
  updateFacts(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('userId', new ZodValidationPipe(employeeUserIdSchema)) userId: string,
    @Body(new ZodValidationPipe(updateEmployeeFactsSchema))
    body: UpdateEmployeeFactsDto,
  ): Promise<EmployeeProfileView> {
    return this.profiles.updateFacts(access, agencyId, userId, body);
  }

  /** Records the date (may be in the future) and flips the status now. */
  @Post(':userId/terminate')
  @HttpCode(HttpStatus.OK)
  terminate(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('userId', new ZodValidationPipe(employeeUserIdSchema)) userId: string,
    @Body(new ZodValidationPipe(terminateEmployeeSchema))
    body: TerminateEmployeeDto,
  ): Promise<EmployeeProfileView> {
    return this.profiles.terminate(access, agencyId, userId, body);
  }
}

/**
 * The employee's own record (PAC-162): read-only rules and schedule, and the
 * two birthday fields they own. `hr:read` — every employee's gate.
 */
@Controller('hr/me/profile')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
@RequirePermissions(modulePermission(ModuleKey.Hr, 'read'))
export class MyHrProfileController {
  constructor(private readonly profiles: EmployeeProfilesService) {}

  /** 404 when the caller has no profile — a platform admin, or a pre-ticket user before the migration. */
  @Get()
  get(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
  ): Promise<MyHrProfileView> {
    return this.profiles.myProfile(access, agencyId);
  }

  @Patch()
  update(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(updateMyHrProfileSchema))
    body: UpdateMyHrProfileDto,
  ): Promise<MyHrProfileView> {
    return this.profiles.updateMyProfile(access, agencyId, body);
  }
}
