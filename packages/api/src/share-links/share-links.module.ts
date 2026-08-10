import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadsModule } from '../leads/leads.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PublicLeadsController } from './public-leads.controller';
import { PublicLeadsService } from './public-leads.service';
import { ShareLink, ShareLinkSchema } from './schemas/share-link.schema';
import { ShareLinksController } from './share-links.controller';
import { ShareLinksService } from './share-links.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ShareLink.name, schema: ShareLinkSchema },
      // The public route has no guard chain, so it resolves the agency itself
      // to check status + module entitlement, and the user to confirm the
      // link's producer is still active.
      { name: Agency.name, schema: AgencySchema },
      { name: User.name, schema: UserSchema },
    ]),
    // For `LeadIntakeService` — the public path runs the identical pipeline.
    LeadsModule,
  ],
  controllers: [ShareLinksController, PublicLeadsController],
  providers: [ShareLinksService, PublicLeadsService],
})
export class ShareLinksModule {}
