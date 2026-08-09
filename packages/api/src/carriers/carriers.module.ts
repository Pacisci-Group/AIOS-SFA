import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CarriersController } from './carriers.controller';
import { CarriersService } from './carriers.service';
import { Carrier, CarrierSchema } from './schemas/carrier.schema';

/**
 * Carrier catalog (PAC-56 #19).
 *
 * `CarriersService` is exported because `SoldDealsService` uses it to resolve a
 * submitted carrier's policy-number pattern at write time (#20) — the client
 * check is an assist, this is the enforcement point.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Carrier.name, schema: CarrierSchema }]),
  ],
  controllers: [CarriersController],
  providers: [CarriersService],
  exports: [CarriersService, MongooseModule],
})
export class CarriersModule {}
