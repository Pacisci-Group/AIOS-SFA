import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { LeadsModule } from '../leads/leads.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { Activity, ActivitySchema } from './schemas/activity.schema';

// `LeadsModule` for its exported `LeadAccessService` — the one scope clamp
// every lead-scoped write path shares. `TenantContextResolver` comes from the
// global `TenancyModule` and is deliberately not imported.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Activity.name, schema: ActivitySchema },
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
    ]),
    LeadsModule,
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
})
export class ActivitiesModule {}
