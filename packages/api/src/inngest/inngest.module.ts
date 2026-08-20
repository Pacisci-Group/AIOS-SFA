import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { INNGEST_CLIENT, createInngestClient } from './inngest.client';
import { InngestRegistry } from './inngest-registry.service';
import { InngestService } from './inngest.service';

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
 */
@Global()
@Module({
  // DiscoveryModule lets InngestRegistry find @InngestFunction() providers
  // wherever they are declared — which is always inside src/worker/, but the
  // registry itself stays domain-agnostic and lives here so that main.ts can
  // mount the serve handler without importing across the worker boundary.
  imports: [ConfigModule, DiscoveryModule],
  providers: [
    {
      provide: INNGEST_CLIENT,
      inject: [ConfigService],
      useFactory: createInngestClient,
    },
    InngestService,
    InngestRegistry,
  ],
  exports: [INNGEST_CLIENT, InngestService, InngestRegistry],
})
export class InngestModule {}
