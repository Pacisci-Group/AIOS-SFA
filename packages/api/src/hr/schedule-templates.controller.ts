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
  ModuleKey,
  type WorkScheduleTemplateView,
  type WorkScheduleTemplatesResponse,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access, AgencyId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  createScheduleTemplateSchema,
  scheduleTemplateIdSchema,
  updateScheduleTemplateSchema,
  type CreateScheduleTemplateDto,
  type UpdateScheduleTemplateDto,
} from './dto/schedule-template.dto';
import { ScheduleTemplatesService } from './schedule-templates.service';

/**
 * Work schedule templates (PAC-162) — `agency:hr:admin` throughout. An
 * employee's own effective schedule is on `GET /hr/me/profile`.
 */
@Controller('hr/schedule-templates')
@RequireModule(ModuleKey.Hr)
@SkipBranch()
@RequirePermissions(AgencyPermission.HrAdmin)
export class ScheduleTemplatesController {
  constructor(private readonly templates: ScheduleTemplatesService) {}

  /** Active first, then archived. An empty list means everyone is on the workweek. */
  @Get()
  list(@AgencyId() agencyId: string): Promise<WorkScheduleTemplatesResponse> {
    return this.templates.list(agencyId);
  }

  /** A name; the schedule defaults to the agency workweek 09:00–17:00. 409 on a duplicate name. */
  @Post()
  create(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(createScheduleTemplateSchema))
    body: CreateScheduleTemplateDto,
  ): Promise<WorkScheduleTemplateView> {
    return this.templates.create(access, agencyId, body);
  }

  @Get(':id')
  get(
    @AgencyId() agencyId: string,
    @Param('id', new ZodValidationPipe(scheduleTemplateIdSchema)) id: string,
  ): Promise<WorkScheduleTemplateView> {
    return this.templates.get(agencyId, id);
  }

  /** A name, a schedule, or both; bumps `version`. */
  @Patch(':id')
  update(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('id', new ZodValidationPipe(scheduleTemplateIdSchema)) id: string,
    @Body(new ZodValidationPipe(updateScheduleTemplateSchema))
    body: UpdateScheduleTemplateDto,
  ): Promise<WorkScheduleTemplateView> {
    return this.templates.update(access, agencyId, id, body);
  }

  /** 409 while employees are on it. */
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Access() access: AccessContext,
    @AgencyId() agencyId: string,
    @Param('id', new ZodValidationPipe(scheduleTemplateIdSchema)) id: string,
  ): Promise<WorkScheduleTemplateView> {
    return this.templates.archive(access, agencyId, id);
  }
}
