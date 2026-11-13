import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  AgencyPermission,
  ModuleKey,
  type AccessContext,
  type PaymentStructureSummary,
  type PaymentStructureView,
  type PaymentStructuresResponse,
  type PayoutPeopleResponse,
  type PayoutSettingsView,
} from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  SkipBranch,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  paymentStructureIdSchema,
  updatePaymentStructureSchema,
  updatePayoutSettingsSchema,
  upsertPaymentStructureSchema,
  type UpdatePaymentStructureDto,
  type UpdatePayoutSettingsDto,
  type UpsertPaymentStructureDto,
} from './dto/payouts.dto';
import {
  agencyOf,
  PaymentStructuresService,
} from './payment-structures.service';
import { PayoutSettingsService } from './payout-settings.service';

/**
 * Payouts administration (PAC-177): the agency's payout settings and its
 * payment structures — how much everyone is paid.
 *
 * All of it is `agency:payouts:admin`, the owner's by default, never the page
 * pair: a branch manager reviews and sends statements (`payouts:write`), but
 * does not set the rates. Agency-wide by design — a structure belongs to the
 * agency, not to a branch — so no data scope applies and the branch header is
 * not consulted.
 */
@Controller('payouts')
@RequireModule(ModuleKey.Payouts)
@RequirePermissions(AgencyPermission.PayoutsAdmin)
@SkipBranch()
export class PayoutsAdminController {
  constructor(
    private readonly settings: PayoutSettingsService,
    private readonly structures: PaymentStructuresService,
  ) {}

  // --- Settings --------------------------------------------------------------

  /** The team bonus and Salesperson of the Month, defaults filled in. */
  @Get('settings')
  getSettings(@Access() access: AccessContext): Promise<PayoutSettingsView> {
    return this.settings.get(agencyOf(access));
  }

  /**
   * Either section, each sent whole. 400 when the team shares do not add up
   * to 100% or an amount has a third decimal.
   */
  @Patch('settings')
  updateSettings(
    @Access() access: AccessContext,
    @Body(new ZodValidationPipe(updatePayoutSettingsSchema))
    body: UpdatePayoutSettingsDto,
  ): Promise<PayoutSettingsView> {
    return this.settings.update(agencyOf(access), body);
  }

  // --- Structures ------------------------------------------------------------

  @Get('structures')
  listStructures(
    @Access() access: AccessContext,
  ): Promise<PaymentStructuresResponse> {
    return this.structures.list(access);
  }

  /**
   * Who can be put on a structure and where each person is today. Declared
   * before `structures/:id` so the literal segment is not read as an id.
   */
  @Get('structures/people')
  people(@Access() access: AccessContext): Promise<PayoutPeopleResponse> {
    return this.structures.peopleOptions(access);
  }

  @Get('structures/:id')
  getStructure(
    @Access() access: AccessContext,
    @Param('id', new ZodValidationPipe(paymentStructureIdSchema)) id: string,
  ): Promise<PaymentStructureView> {
    return this.structures.detail(access, id);
  }

  /**
   * 201 with the new structure. Its members leave whichever structure they
   * were on. 409 `PAYMENT_STRUCTURE_NAME_TAKEN` for an active name in use.
   */
  @Post('structures')
  createStructure(
    @Access() access: AccessContext,
    @Body(new ZodValidationPipe(upsertPaymentStructureSchema))
    body: UpsertPaymentStructureDto,
  ): Promise<PaymentStructureView> {
    return this.structures.create(access, body);
  }

  /**
   * The whole structure, replaced. 409 when it is archived, and 409
   * `PAYMENT_STRUCTURE_STALE` when `expectedUpdatedAt` is not the stored
   * `updatedAt` — it was saved somewhere else since the page loaded it.
   */
  @Patch('structures/:id')
  updateStructure(
    @Access() access: AccessContext,
    @Param('id', new ZodValidationPipe(paymentStructureIdSchema)) id: string,
    @Body(new ZodValidationPipe(updatePaymentStructureSchema))
    body: UpdatePaymentStructureDto,
  ): Promise<PaymentStructureView> {
    return this.structures.update(access, id, body);
  }

  /** Releases the members; 409 when already archived. */
  @Post('structures/:id/archive')
  @HttpCode(200)
  archiveStructure(
    @Access() access: AccessContext,
    @Param('id', new ZodValidationPipe(paymentStructureIdSchema)) id: string,
  ): Promise<PaymentStructureSummary> {
    return this.structures.archive(access, id);
  }
}
