import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../mail/mail.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import {
  CrmRotation,
  CrmRotationSchema,
} from '../crm-rotations/schemas/crm-rotation.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from '../crm/schemas/service-ticket.schema';
import { User, UserSchema } from './schemas/user.schema';
import { UserWorkReleaseService } from './user-work-release.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    PermissionsModule,
    MailModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: Agency.name, schema: AgencySchema },
      // Read by `UserWorkReleaseService` when an employee is removed. Schemas
      // only — the CRM *services* are not imported, so removing a user does not
      // drag the CRM module's dependency graph into this one.
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      { name: CrmRotation.name, schema: CrmRotationSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService, UserWorkReleaseService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
