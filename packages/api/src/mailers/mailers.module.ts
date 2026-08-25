import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InngestModule } from '../inngest/inngest.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { PlatformMailersController } from './platform-mailers.controller';
import { PlatformMailersService } from './platform-mailers.service';
import { Mailer, MailerSchema } from './schemas/mailer.schema';
import {
  MailerImportRun,
  MailerImportRunSchema,
} from './schemas/mailer-import-run.schema';

/**
 * Mailers (PAC-73).
 *
 * Today this is the **platform** side only — uploading an RTP file and turning
 * it into `mailers` documents. The agency-facing surface (the QCN lookup and
 * the Mailers drawer, PAC-61) is still the generated stub in
 * `feature-modules/feature.controllers.ts`; when the real one lands it must
 * replace that stub **in the same commit**, because two classes on
 * `@Controller('mailers')` both register and which one answers depends on
 * module import order. This controller is on `platform/mailers`, so it does not
 * collide and the stub stays for now.
 *
 * `StorageService` comes from the global `StorageModule` and needs no import
 * here.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Mailer.name, schema: MailerSchema },
      { name: MailerImportRun.name, schema: MailerImportRunSchema },
      { name: Agency.name, schema: AgencySchema },
    ]),
    InngestModule,
  ],
  controllers: [PlatformMailersController],
  providers: [PlatformMailersService],
  // Exported so the demo seed and the BigQuery backfill can inject the models
  // without re-registering the schemas — the same thing `PlatformModule` does.
  exports: [MongooseModule],
})
export class MailersModule {}
