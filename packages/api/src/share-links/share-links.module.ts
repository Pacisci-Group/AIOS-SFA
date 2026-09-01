import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadsModule } from '../leads/leads.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PublicLeadsController } from './public-leads.controller';
import { PublicLeadsService } from './public-leads.service';
import { ShareLink, ShareLinkSchema } from './schemas/share-link.schema';
import { ShareLinkAccessService } from './share-link-access.service';
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
  providers: [ShareLinksService, PublicLeadsService, ShareLinkAccessService],
  /*
   * `ShareLinkAccessService` + the `ShareLink` model are exported for
   * `AddressModule`'s public routes (PAC-60), which are `@Public()` and must
   * therefore repeat every check the guard chain would have made. Exporting the
   * one implementation is what stops a second, hand-copied version drifting
   * into being more helpful about which tokens exist.
   */
  exports: [ShareLinkAccessService, MongooseModule],
})
export class ShareLinksModule {}
