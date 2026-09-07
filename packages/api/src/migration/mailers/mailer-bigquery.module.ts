import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ENV_FILE_PATH } from '../../config/env.config';
import { Carrier, CarrierSchema } from '../../carriers/schemas/carrier.schema';
import { Mailer, MailerSchema } from '../../mailers/schemas/mailer.schema';
import {
  MailerCampaign,
  MailerCampaignSchema,
} from '../../mailers/schemas/mailer-campaign.schema';
import { Agency, AgencySchema } from '../../platform/schemas/agency.schema';

/**
 * Self-contained root module for the BigQuery mailer backfill.
 *
 * Its own config and connection, following `MigrationModule` and
 * `DemoSeedModule`: this runs as a standalone Nest application context so it
 * never boots the HTTP guards, the throttler, the Inngest client or a single
 * controller — none of which an offline import has any use for.
 *
 * Registers only the models it touches. `MailerCampaign` is among them because
 * `Mailer.campaignId` is required (PAC-71): rows are bucketed into **implicit**
 * campaigns keyed `(agency, week, year)`, marked `source: 'migration'` so they
 * are distinguishable from a run an operator actually performed. `Carrier` is
 * read-only here — the campaign needs one and this script never creates it.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://localhost:27017/sfa'),
      }),
    }),
    MongooseModule.forFeature([
      { name: Mailer.name, schema: MailerSchema },
      { name: MailerCampaign.name, schema: MailerCampaignSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: Carrier.name, schema: CarrierSchema },
    ]),
  ],
})
export class MailerBigQueryModule {}
