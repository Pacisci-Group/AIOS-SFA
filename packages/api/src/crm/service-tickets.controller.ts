import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import {
  AddNoteDto,
  CreateServiceTicketDto,
  ListTicketsQueryDto,
  UpdateStatusDto,
} from './dto/service-ticket.dto';
import { ServiceTicketsService } from './service-tickets.service';

/**
 * CRM Service tickets. Reading the page requires `crm_service:read`; every
 * mutation requires `crm_service:write`. Results are scoped to the caller's
 * data scope (own / branch / agency) by the service.
 */
@Controller('crm/service-tickets')
@RequireModule(ModuleKey.CrmService)
@RequirePermissions(modulePermission(ModuleKey.CrmService, 'read'))
export class ServiceTicketsController {
  constructor(private readonly ticketsService: ServiceTicketsService) {}

  @Get()
  list(@Access() access: AccessContext, @Query() query: ListTicketsQueryDto) {
    return this.ticketsService.list(access, query);
  }

  @Get('stats')
  stats(@Access() access: AccessContext) {
    return this.ticketsService.stats(access);
  }

  @Get(':id')
  findOne(@Access() access: AccessContext, @Param('id') id: string) {
    return this.ticketsService.findOne(access, id);
  }

  @Post()
  @RequireWrite(ModuleKey.CrmService)
  create(
    @Access() access: AccessContext,
    @Body() dto: CreateServiceTicketDto,
  ) {
    return this.ticketsService.create(access, dto);
  }

  @Patch(':id/status')
  @RequireWrite(ModuleKey.CrmService)
  updateStatus(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.ticketsService.updateStatus(access, id, dto);
  }

  @Post(':id/notes')
  @RequireWrite(ModuleKey.CrmService)
  addNote(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
  ) {
    return this.ticketsService.addNote(access, id, dto);
  }
}
