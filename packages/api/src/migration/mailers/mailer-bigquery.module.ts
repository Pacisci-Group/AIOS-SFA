import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ENV_FILE_PATH } from '../../config/env.config';
import { Mailer, MailerSchema } from '../../mailers/schemas/mailer.schema';
import { Agency, AgencySchema } from '../../platform/schemas/agency.schema';

/**
 * Self-contained root module for the BigQuery mailer backfill.
 *
 * Its own config and connection, following `MigrationModule` and
 * `DemoSeedModule`: this runs as a standalone Nest application context so it
 * never boots the HTTP guards, the throttler, the Inngest client or a single
 * controller — none of which an offline import has any use for.
 *
 * Registers only the two models it touches. `MailerImportRun` is deliberately
 * absent: run records describe an **operator's upload** through the panel, and
 * inventing one for a deploy-time script would put a row in the panel's history
 * that nobody uploaded.
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
      { name: Agency.name, schema: AgencySchema },
    ]),
  ],
})
export class MailerBigQueryModule {}
