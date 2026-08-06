import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

// Both models are owned by other modules; re-registering is the house pattern
// (see DealAuditsModule) and is what gives this module its own injection
// tokens. Nothing globally provided is imported here.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
    ]),
  ],
  controllers: [PerformanceController],
  providers: [PerformanceService],
})
export class PerformanceModule {}
