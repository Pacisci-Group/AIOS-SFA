import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ENV_FILE_PATH } from '../config/env.config';
import { AcmeChallengeService } from './acme-challenge.service';
import { CertificateStoreService } from './certificate-store.service';
import {
  AcmeChallenge,
  AcmeChallengeSchema,
} from './schemas/acme-challenge.schema';
import { Certificate, CertificateSchema } from './schemas/certificate.schema';

/**
 * Root module for the **TLS edge** process (`dist/edge.js`).
 *
 * Self-contained, the same way `WorkerRootModule` is: it re-declares config and
 * the database connection so it boots without `AppModule`, and therefore
 * without the global guards, the throttler, or a single controller — none of
 * which an edge has any use for. It is not an HTTP application at all; the
 * entrypoint asks this container for one service and then runs raw `tls` and
 * `http` servers.
 *
 * ## Deliberately the smallest module in the repo
 * This process is the only one listening on a public port, and it is the first
 * thing every request in the platform touches. Every module imported here would
 * be code running in front of the entire app, so it gets exactly one: the
 * certificate lookup.
 *
 * Notably absent is `InngestModule`. The edge sends no events and runs no
 * functions — an edge that could enqueue work would be an edge that could be
 * made to enqueue work by an unauthenticated caller.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE_PATH }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI', 'mongodb://localhost:27017/sfa'),
        // Same reasoning as the worker: the API owns every index it declares,
        // and an edge building them would race the API's autoIndex at boot from
        // whatever subset of the schema this process happens to register.
        autoIndex: false,
        autoCreate: false,
      }),
    }),
    MongooseModule.forFeature([
      { name: Certificate.name, schema: CertificateSchema },
      // The edge answers ACME challenges itself rather than proxying them:
      // its upstream is nginx, whose SPA fallback would return index.html
      // with a 200 and fail every validation while looking healthy.
      { name: AcmeChallenge.name, schema: AcmeChallengeSchema },
    ]),
  ],
  providers: [AcmeChallengeService, CertificateStoreService],
})
export class EdgeRootModule {}
