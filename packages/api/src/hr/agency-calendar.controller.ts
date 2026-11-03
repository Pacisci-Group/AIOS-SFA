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
  type AddCalendarDaysResponse,
  type AgencyCalendarDayView,
  type AgencyCalendarView,
  AgencyPermission,
  type HolidayProposalView,
  type HolidayRegionsResponse,
  type HolidaySuggestionsResponse,
  ModuleKey,
  modulePermission,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AgencyCalendarService } from './agency-calendar.service';
import {
  addCalendarDaysSchema,
  calendarDayIdSchema,
  calendarYearQuerySchema,
  confirmHolidayProposalSchema,
  holidayRegionsQuerySchema,
  holidaySuggestionsQuerySchema,
  proposalYearParamSchema,
  removeCalendarDaySchema,
  updateAgencyCalendarSchema,
  type AddCalendarDaysDto,
  type CalendarYearQueryDto,
  type ConfirmHolidayProposalDto,
  type HolidayRegionsQueryDto,
  type HolidaySuggestionsQueryDto,
  type RemoveCalendarDayDto,
  type UpdateAgencyCalendarDto,
} from './dto/calendar.dto';

/**
 * The agency calendar (PAC-161).
 *
 * Reading it is `hr:read` — every employee's gate, because the employee
 * calendar page (PAC-169) and the time-off form (PAC-165) both show it.
 * Changing it is `agency:hr:admin`: an admin capability, not the module's
 * `:write`, which is the *reviewer* capability over other people's records.
 *
 * `@SkipBranch()` — one calendar per agency, nothing per branch in v1.
 */
@Controller('hr/calendar')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
export class AgencyCalendarController {
  constructor(private readonly calendar: AgencyCalendarService) {}

  /** The year's rows, the workweek, working days per month, any pending proposal. */
  @Get()
  @RequirePermissions(modulePermission(ModuleKey.Hr, 'read'))
  view(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Query(new ZodValidationPipe(calendarYearQuerySchema))
    query: CalendarYearQueryDto,
  ): Promise<AgencyCalendarView> {
    return this.calendar.view(access, agencyId, query.year);
  }

  @Patch()
  @RequirePermissions(AgencyPermission.HrAdmin)
  update(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(updateAgencyCalendarSchema))
    body: UpdateAgencyCalendarDto,
  ): Promise<AgencyCalendarView> {
    return this.calendar.update(access, agencyId, body);
  }

  /** Countries, or the regions of one, for the pickers. */
  @Get('holiday-regions')
  @RequirePermissions(AgencyPermission.HrAdmin)
  regions(
    @Query(new ZodValidationPipe(holidayRegionsQuerySchema))
    query: HolidayRegionsQueryDto,
  ): HolidayRegionsResponse {
    return this.calendar.regions(query.country);
  }

  /** `date-holidays` on the API; `public` pre-checked, the rest unchecked. */
  @Get('holiday-suggestions')
  @RequirePermissions(AgencyPermission.HrAdmin)
  suggestions(
    @AgencyId() agencyId: string,
    @Query(new ZodValidationPipe(holidaySuggestionsQuerySchema))
    query: HolidaySuggestionsQueryDto,
  ): Promise<HolidaySuggestionsResponse> {
    return this.calendar.suggestions(agencyId, query);
  }

  /** Bulk add. 409 names any date already on the calendar; nothing is written then. */
  @Post('days')
  @RequirePermissions(AgencyPermission.HrAdmin)
  addDays(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(addCalendarDaysSchema))
    body: AddCalendarDaysDto,
  ): Promise<AddCalendarDaysResponse> {
    return this.calendar.addDays(access, agencyId, body);
  }

  /** Soft remove with a reason. A removed row is a 404 on a second call. */
  @Delete('days/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(AgencyPermission.HrAdmin)
  removeDay(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('id', new ZodValidationPipe(calendarDayIdSchema)) id: string,
    @Body(new ZodValidationPipe(removeCalendarDaySchema))
    body: RemoveCalendarDayDto,
  ): Promise<AgencyCalendarDayView> {
    return this.calendar.removeDay(access, agencyId, id, body.reason);
  }

  /** Write the chosen dates and mark the proposal confirmed. Idempotent. */
  @Post('proposals/:year/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(AgencyPermission.HrAdmin)
  confirmProposal(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('year', new ZodValidationPipe(proposalYearParamSchema)) year: number,
    @Body(new ZodValidationPipe(confirmHolidayProposalSchema))
    body: ConfirmHolidayProposalDto,
  ): Promise<HolidayProposalView> {
    return this.calendar.confirmProposal(access, agencyId, year, body);
  }

  @Post('proposals/:year/dismiss')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(AgencyPermission.HrAdmin)
  dismissProposal(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('year', new ZodValidationPipe(proposalYearParamSchema)) year: number,
  ): Promise<HolidayProposalView> {
    return this.calendar.dismissProposal(access, agencyId, year);
  }
}
