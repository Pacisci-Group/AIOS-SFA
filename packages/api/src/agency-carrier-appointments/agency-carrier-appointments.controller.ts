import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AgencyPermission } from '@sfa/shared';
import type { CarrierAppointmentsResponse } from '@sfa/shared';
import {
  RequirePermissions,
  SkipBranch,
  SkipModule,
} from '../common/decorators/access.decorators';
import { AgencyId } from '../common/decorators/user.decorators';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CarriersService } from '../carriers/carriers.service';
import { AgencyCarrierAppointmentsService } from './agency-carrier-appointments.service';
import {
  replaceCarrierAppointmentsSchema,
  type ReplaceCarrierAppointmentsDto,
} from './dto/carrier-appointments.dto';

/**
 * An agency's own carrier appointments (PAC-93).
 *
 * `@SkipModule` for the same reason as branding, domains and email: an
 * appointment is agency identity, not a product module that can be switched
 * off. `@SkipBranch` because an appointment belongs to the agency, not to one
 * of its offices. The gate is `agency:carrier_appointments:*`, which only the
 * Agency Owner holds by default.
 *
 * ⚠ **Not hung off `CarriersController`.** That one is gated on the
 * `deal_audits` / `crm_service` *modules*, so an agency with neither enabled
 * would lose its own settings page.
 */
@Controller('agency/carrier-appointments')
@SkipModule()
@SkipBranch()
@UseGuards(PermissionsGuard)
export class AgencyCarrierAppointmentsController {
  constructor(
    private readonly appointments: AgencyCarrierAppointmentsService,
    private readonly carriers: CarriersService,
  ) {}

  /**
   * The appointments **and** the carriers one may target.
   *
   * The options ride along rather than being fetched from `GET /carriers`
   * because that route is module-gated (see the class note) and because it
   * guarantees the picker offers exactly the set this endpoint validates
   * against. `list(null)` is globals only, which is that set.
   */
  @Get()
  @RequirePermissions(AgencyPermission.CarrierAppointmentsRead)
  async get(
    @AgencyId() agencyId: string,
  ): Promise<CarrierAppointmentsResponse> {
    const [appointments, { carriers }] = await Promise.all([
      this.appointments.list(agencyId),
      this.carriers.list(null),
    ]);
    return { appointments, carrierOptions: carriers };
  }

  /**
   * Replace the whole list.
   *
   * `PUT`, not the house `PATCH`, because the semantics genuinely are
   * replacement — `PATCH /platform/agencies/:id/modules` merges, this does not.
   * Whole-array rather than granular add/remove routes because
   * `CarrierAppointment` is `_id: false`, so no appointment is individually
   * addressable, and because "exactly one primary" and "no duplicate pairs" are
   * properties of the whole list: three granular endpoints would mean three
   * copies of the invariant.
   *
   * ⚠ Two operators editing at once will clobber each other. Accepted, not
   * overlooked: there is no ETag/`If-Match` convention anywhere in this API, and
   * inventing one for this endpoint would make it the only place with one.
   */
  @Put()
  @RequirePermissions(AgencyPermission.CarrierAppointmentsWrite)
  replace(
    @AgencyId() agencyId: string,
    @Body(new ZodValidationPipe(replaceCarrierAppointmentsSchema))
    body: ReplaceCarrierAppointmentsDto,
  ) {
    return this.appointments
      .replaceAll(agencyId, body.appointments)
      .then((appointments) => ({ appointments }));
  }
}
