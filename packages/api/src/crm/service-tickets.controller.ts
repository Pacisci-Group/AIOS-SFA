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
  CompleteRenewalStepDto,
  CreateServiceTicketDto,
  ListTicketsQueryDto,
  UpdateOnboardingChecklistDto,
  SetRenewalOutcomeDto,
  UpdateOnboardingEmailsDto,
  UpdateRenewalPoliciesDto,
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

  /** CRM/CSR users assignable as a ticket's Client Relation Manager. */
  @Get('assignees')
  assignees(@Access() access: AccessContext) {
    return this.ticketsService.listAssignees(access);
  }

  /* ------------------------------------------------------------------ *
   * Proactive renewal outreach
   *
   * Renewal is a ticket category, not a separate module — these routes ride
   * the same `crm_service` permissions as everything above, which `csr` and
   * `crm` already hold.
   *
   * Declared before `GET :id` so the literal path segments win, the same
   * ordering `stats` and `assignees` rely on.
   * ------------------------------------------------------------------ */

  /**
   * The Proactive Renewal Outreach desk. Also the primary trigger for
   * materializing cycles — there is no cron, so reading the desk is what makes
   * renewals appear.
   */
  @Get('renewals/desk')
  renewalDesk(@Access() access: AccessContext) {
    return this.ticketsService.renewalDesk(access);
  }

  /** One cycle: its policy checklist and both calls. Reconciles before serving. */
  @Get('renewals/:renewalCycleId')
  getRenewalCycle(
    @Access() access: AccessContext,
    @Param('renewalCycleId') renewalCycleId: string,
  ) {
    return this.ticketsService.getRenewalCycle(access, renewalCycleId);
  }

  @Get(':id')
  findOne(@Access() access: AccessContext, @Param('id') id: string) {
    return this.ticketsService.findOne(access, id);
  }

  /** Tick a policy off the call's checklist. Persists on the parent cycle. */
  @Patch(':id/renewal/policies')
  @RequireWrite(ModuleKey.CrmService)
  updateRenewalPolicies(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: UpdateRenewalPoliciesDto,
  ) {
    return this.ticketsService.updateRenewalPolicies(access, id, dto);
  }

  /**
   * Close a renewal call. 400s unless every policy has been ticked, and — on
   * the renewal review — unless an outcome is supplied.
   */
  @Post(':id/renewal/steps/:stepKey/complete')
  @RequireWrite(ModuleKey.CrmService)
  completeRenewalStep(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Param('stepKey') stepKey: string,
    @Body() dto: CompleteRenewalStepDto,
  ) {
    return this.ticketsService.completeRenewalStep(access, id, stepKey, dto);
  }

  /** Correct a recorded outcome after the call. */
  @Patch(':id/renewal/outcome')
  @RequireWrite(ModuleKey.CrmService)
  setRenewalOutcome(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: SetRenewalOutcomeDto,
  ) {
    return this.ticketsService.setRenewalOutcome(access, id, dto);
  }

  @Post()
  @RequireWrite(ModuleKey.CrmService)
  create(@Access() access: AccessContext, @Body() dto: CreateServiceTicketDto) {
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

  /* ------------------------------------------------------------------ *
   * Onboarding
   *
   * Onboarding is a ticket category, not a separate module — these routes
   * are gated by the same `crm_service` permissions as everything above,
   * which `csr` and `crm` already hold. They 400 on a non-onboarding ticket.
   * ------------------------------------------------------------------ */

  /**
   * The per-client onboarding record behind a chain of tickets — the "Step 2
   * of 3" view. Two path segments, so it never collides with the single-segment
   * `GET :id` above.
   */
  @Get('onboardings/:onboardingId')
  getOnboarding(
    @Access() access: AccessContext,
    @Param('onboardingId') onboardingId: string,
  ) {
    return this.ticketsService.getOnboarding(access, onboardingId);
  }

  /** Every onboarding for a client, newest first. */
  @Get('onboardings/household/:householdId')
  listOnboardingsForHousehold(
    @Access() access: AccessContext,
    @Param('householdId') householdId: string,
  ) {
    return this.ticketsService.listOnboardingsForHousehold(access, householdId);
  }

  @Post(':id/onboarding/steps/:stepKey/complete')
  @RequireWrite(ModuleKey.CrmService)
  completeOnboardingStep(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Param('stepKey') stepKey: string,
  ) {
    return this.ticketsService.completeOnboardingStep(access, id, stepKey);
  }

  @Patch(':id/onboarding/checklist')
  @RequireWrite(ModuleKey.CrmService)
  updateOnboardingChecklist(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingChecklistDto,
  ) {
    return this.ticketsService.updateOnboardingChecklist(access, id, dto);
  }

  @Patch(':id/onboarding/emails')
  @RequireWrite(ModuleKey.CrmService)
  updateOnboardingEmails(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: UpdateOnboardingEmailsDto,
  ) {
    return this.ticketsService.updateOnboardingEmails(access, id, dto);
  }
}
