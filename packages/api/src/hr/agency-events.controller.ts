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
} from '@nestjs/common';
import {
  type AccessContext,
  AgencyPermission,
  ModuleKey,
  type AgencyEventAudienceOptions,
  type AgencyEventImpact,
  type AgencyEventView,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AgencyEventsService } from './agency-events.service';
import {
  agencyEventSchema,
  eventIdParamSchema,
  type AgencyEventDto,
} from './dto/agency-event.dto';

/**
 * Agency events (PAC-169) — the dates an agency adds to the HR calendar and
 * what they do to time off: nothing, "no time off", or a day off.
 *
 * Every route is `agency:hr:admin`, like the HR policies: an event is the
 * agency's configuration. Reading events is `GET /hr/calendar` (`hr:read`),
 * which returns the ones that are for the caller.
 *
 * `@SkipBranch()` — an event belongs to the agency; its audience may name
 * branches, but that is data, not the request's branch.
 *
 * The static routes are declared before `:eventId` so they are never read
 * as an id.
 */
@Controller('hr/events')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
export class AgencyEventsController {
  constructor(private readonly events: AgencyEventsService) {}

  /** Every branch and every person not removed — the audience pickers. */
  @Get('audience-options')
  @RequirePermissions(AgencyPermission.HrAdmin)
  audienceOptions(
    @AgencyId() agencyId: string,
  ): Promise<AgencyEventAudienceOptions> {
    return this.events.audienceOptions(agencyId);
  }

  /**
   * The live time off requests an event would run into. Writes nothing.
   * Requests outside what the caller may see of people's leave are counted,
   * not listed.
   */
  @Post('impact')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(AgencyPermission.HrAdmin)
  impact(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(agencyEventSchema)) body: AgencyEventDto,
  ): Promise<AgencyEventImpact> {
    return this.events.impact(access, agencyId, body);
  }

  /** 400 when a branch or person named is not this agency's. */
  @Post()
  @RequirePermissions(AgencyPermission.HrAdmin)
  create(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(agencyEventSchema)) body: AgencyEventDto,
  ): Promise<{ event: AgencyEventView; impact: AgencyEventImpact }> {
    return this.events.create(access, agencyId, body);
  }

  /** The event with its audience ids — what the edit form opens on. */
  @Get(':eventId')
  @RequirePermissions(AgencyPermission.HrAdmin)
  get(
    @AgencyId() agencyId: string,
    @Param(new ZodValidationPipe(eventIdParamSchema))
    params: { eventId: string },
  ): Promise<AgencyEventView> {
    return this.events.get(agencyId, params.eventId);
  }

  /** The whole event, as the form holds it. */
  @Patch(':eventId')
  @RequirePermissions(AgencyPermission.HrAdmin)
  update(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param(new ZodValidationPipe(eventIdParamSchema))
    params: { eventId: string },
    @Body(new ZodValidationPipe(agencyEventSchema)) body: AgencyEventDto,
  ): Promise<{ event: AgencyEventView; impact: AgencyEventImpact }> {
    return this.events.update(access, agencyId, params.eventId, body);
  }

  /** Soft delete. Requests sent while the event stood keep their hours. */
  @Delete(':eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(AgencyPermission.HrAdmin)
  async remove(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param(new ZodValidationPipe(eventIdParamSchema))
    params: { eventId: string },
  ): Promise<void> {
    await this.events.remove(access, agencyId, params.eventId);
  }
}
