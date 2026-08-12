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
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  presignTransferDocumentSchema,
  type PresignTransferDocumentDto,
} from '../sold-deals/dto/presign-sold-document.dto';
import {
  createPolicyTransferSchema,
  type CreatePolicyTransferDto,
} from './dto/policy-transfer.dto';
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

  /**
   * Every ticket a client owns, for the household page's Activity & Tickets
   * column. Includes archived tickets — a client's history is the whole
   * history. Two path segments, so `GET :id` below never swallows it.
   */
  @Get('household/:householdId')
  listForHousehold(
    @Access() access: AccessContext,
    @Param('householdId') householdId: string,
  ) {
    return this.ticketsService.listForHousehold(access, householdId);
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

  /**
   * A presigned PUT for a document on an in-progress policy transfer.
   *
   * Household-anchored rather than lead-anchored (`POST /sold-deals/documents`
   * is the sibling): a transfer has no lead, and the key prefix *is* the
   * ownership check that `record` later re-asserts.
   */
  @Post(':id/policy-transfer/presign')
  @RequireWrite(ModuleKey.CrmService)
  presignPolicyTransferDocument(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(presignTransferDocumentSchema))
    body: PresignTransferDocumentDto,
  ) {
    return this.ticketsService.presignPolicyTransferDocument(access, id, body);
  }

  /**
   * Record the client's move from one package to another.
   *
   * Books a `Deal` with `businessType: 'company_transfer'` plus its policies,
   * retires the policies being replaced, and generates the hand-off checklist —
   * the Sold pipeline, minus the lead, labelled so it never counts as new
   * business. One per ticket.
   */
  @Post(':id/policy-transfer')
  @RequireWrite(ModuleKey.CrmService)
  recordPolicyTransfer(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createPolicyTransferSchema))
    body: CreatePolicyTransferDto,
  ) {
    return this.ticketsService.recordPolicyTransfer(access, id, body);
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
