import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WorkerRootModule } from './worker/worker-root.module';
import { mountInngest } from './inngest/inngest-serve';

/**
 * Standalone worker entrypoint — `dist/worker.js`.
 *
 * This file *is* the extraction, done up front. It boots the same
 * {@link WorkerModule} the API boots inline, with its own config and database
 * connection and none of the HTTP feature surface. Splitting the worker onto
 * its own container is then: set `WORKER_INLINE=false` on the API, start the
 * `worker` compose profile, and repoint `INNGEST_URLS` at this process.
 *
 * Keeping it *running* (via `npm run worker:dev`) is what stops that path
 * rotting between now and the day it is needed.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    WorkerRootModule,
    // Inngest POSTs JSON to the serve handler, so a body parser is required.
    { bodyParser: true },
  );

  // Function payloads carry rendered email content and can exceed the 100kb
  // Express default. Matches the limit the API side uses.
  app.useBodyParser('json', { limit: '10mb' });

  // Lets Inngest finish an in-flight invocation on SIGTERM instead of having it
  // cut off and retried. Absent from the API's own bootstrap today.
  app.enableShutdownHooks();

  mountInngest(app);

  // Binds on all interfaces: Inngest reaches this over the container network
  // (or, once split out, over the VPC), never over loopback.
  const port = Number(process.env.WORKER_PORT ?? 4001);
  await app.listen(port, '0.0.0.0');
  console.log(`SFA worker listening on http://localhost:${port}/api/inngest`);
}

void bootstrap();
