import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ServiceTicketsController } from './service-tickets.controller';
import { ServiceTicketsService } from './service-tickets.service';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from './schemas/service-ticket.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ServiceTicketsController],
  providers: [ServiceTicketsService],
  exports: [ServiceTicketsService, MongooseModule],
})
export class CrmModule {}
