import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CarriersModule } from '../carriers/carriers.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { AgencyCarrierAppointmentsController } from './agency-carrier-appointments.controller';
import { AgencyCarrierAppointmentsService } from './agency-carrier-appointments.service';

/**
 * Carrier appointments (PAC-93).
 *
 * Registers the `Agency` schema directly rather than importing `PlatformModule`
 * — the schema is the dependency, not the module, and taking the module would
 * create a cycle the moment `PlatformModule` imports this one back for
 * `AgencyProvisioningService`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Agency.name, schema: AgencySchema }]),
    CarriersModule,
  ],
  controllers: [AgencyCarrierAppointmentsController],
  providers: [AgencyCarrierAppointmentsService],
  exports: [AgencyCarrierAppointmentsService],
})
export class AgencyCarrierAppointmentsModule {}
