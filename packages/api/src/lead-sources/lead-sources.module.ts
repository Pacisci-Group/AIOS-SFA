import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadSourcesController } from './lead-sources.controller';
import { LeadSourcesService } from './lead-sources.service';
import { LeadSource, LeadSourceSchema } from './schemas/lead-source.schema';

/**
 * Lead-source catalog (PAC-135).
 *
 * `LeadSourcesService` is exported because every writer of a lead validates the
 * picked source through it, and every reader renders the label through it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeadSource.name, schema: LeadSourceSchema },
    ]),
  ],
  controllers: [LeadSourcesController],
  providers: [LeadSourcesService],
  exports: [LeadSourcesService, MongooseModule],
})
export class LeadSourcesModule {}
