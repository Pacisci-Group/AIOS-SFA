import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { INNGEST_CLIENT, createInngestClient } from './inngest.client';
import { InngestRegistry } from './inngest-registry.service';
import { InngestService } from './inngest.service';
import { EventLogService } from './event-log/event-log.service';
import {
  EventLogEntry,
  EventLogEntrySchema,
} from './event-log/event-log.schema';

/**
 * The Inngest client, globally available.
 *
 * Global for the same reason {@link StorageModule} is: producers are scattered
 * across feature modules and threading an import through every one of them
 * buys nothing.
 *
 * This module is imported by **both** roots — `AppModule` (so controllers and
 * services can send events) and `WorkerModule` (so functions can be built and
 * served). Each process therefore gets exactly one client, and within a process
 * the functions and the `serve()` handler share it, which Inngest requires.
 *
 * ## Why the event log lives here and not in `src/worker/`
 * Both sides write to it: the API records `pending` on emit, the worker's
 * middleware records the terminal outcome. `src/worker/**` is under a lint
 * boundary forbidding anything outside it from importing in, so a schema that
 * lived there could not be written by the API. `inngest` is listed in
 * `eslint.config.mjs` as shared infrastructure the worker *may* use — the same
 * reasoning that puts the event catalog in `inngest/events/`.
 */
@Global()
@Module({
  // DiscoveryModule lets InngestRegistry find @InngestFunction() providers
  // wherever they are declared — which is always inside src/worker/, but the
  // registry itself stays domain-agnostic and lives here so that main.ts can
  // mount the serve handler without importing across the worker boundary.
  imports: [
    ConfigModule,
    DiscoveryModule,
    MongooseModule.forFeature([
      { name: EventLogEntry.name, schema: EventLogEntrySchema },
    ]),
  ],
  providers: [
    EventLogService,
    {
      provide: INNGEST_CLIENT,
      // EventLogService is injected so the client can register the event-log
      // middleware, which Inngest constructs itself and cannot inject into.
      inject: [ConfigService, EventLogService],
      useFactory: createInngestClient,
    },
    InngestService,
    InngestRegistry,
  ],
  exports: [INNGEST_CLIENT, InngestService, InngestRegistry, EventLogService],
})
export class InngestModule {}
