import { Controller, Get, Query } from '@nestjs/common';
import {
  type AccessContext,
  ModuleKey,
  modulePermission,
  type HrCalendarFilters,
  type HrCalendarResponse,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  hrCalendarQuerySchema,
  type HrCalendarQueryDto,
} from './dto/hr-calendar.dto';
import { HrCalendarService } from './hr-calendar.service';

const HR_READ = modulePermission(ModuleKey.Hr, 'read');

/**
 * The HR calendar (PAC-169) — `/calendar`.
 *
 * Both routes are `hr:read`: the page is every employee's. What a caller
 * receives is decided in the service — their own leave always, other
 * people's only with `agency:hr:team_calendar` and within their data scope.
 * The permission is deliberately **not** on the route: an employee without
 * it still has a calendar, of holidays, events, birthdays and their own
 * time off.
 *
 * `@SkipBranch()` — nothing here is per request-branch; the branch filter is
 * a query parameter that narrows within the caller's scope.
 */
@Controller('hr/calendar')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
export class HrCalendarController {
  constructor(private readonly calendar: HrCalendarService) {}

  /** Typed entries for an inclusive range of days, at most 92 apart. */
  @Get()
  @RequirePermissions(HR_READ)
  read(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Query(new ZodValidationPipe(hrCalendarQuerySchema))
    query: HrCalendarQueryDto,
  ): Promise<HrCalendarResponse> {
    return this.calendar.read(access, agencyId, query);
  }

  /** The branches and people the page's filters offer; empty without the team calendar. */
  @Get('filters')
  @RequirePermissions(HR_READ)
  filters(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
  ): Promise<HrCalendarFilters> {
    return this.calendar.filters(access, agencyId);
  }
}
