import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { runPendingMigrations } from './database/run-migrations';
import { mountInngest } from './inngest/inngest-serve';

async function bootstrap() {
  /*
   * Pending migrations, before anything else exists.
   *
   * The position is load-bearing — it is *before* `NestFactory.create()`, not
   * merely before `app.listen()`:
   *
   *  - Creating the app compiles every Mongoose model, and compiling a model
   *    fires `autoIndex`. A migration that rebuilds an index would then be
   *    racing Mongoose for the very index it is rebuilding. Running first means
   *    no model exists yet, which is the same reason the old one-off backfill
   *    scripts connected with a bare driver and loaded no schemas.
   *  - Nothing may serve a request against a half-migrated database. This throws
   *    on failure and nothing catches it, so the process exits non-zero and the
   *    container restarts rather than coming up in a broken state.
   *
   * `runPendingMigrations` opens and closes its own short-lived connection;
   * Mongoose connects separately a line later.
   *
   * The worker deliberately does not do this (`worker.ts`): one migrator is
   * enough, and it should be the process whose readiness gates traffic. If a
   * worker outruns a not-yet-migrated database, the lock in
   * `database/run-migrations.ts` is what keeps that safe.
   *
   * `DB_MIGRATE_ON_BOOT=false` suppresses it — an escape hatch for rolling an
   * image back to a commit older than a migration, where re-running the pending
   * list is not what you want.
   *
   * Read from `process.env` rather than `ConfigService`, which does not exist
   * yet. The repo `.env` is nonetheless already loaded by this point: importing
   * `AppModule` above evaluates its `@Module` decorator, and that runs
   * `ConfigModule.forRoot({ envFilePath: ENV_FILE_PATH })` as an import-time
   * side effect. `migrate-mongo-config.js` also loads `.env` for itself, so the
   * migration's own MONGODB_URI does not depend on that ordering — only this
   * one flag does.
   */
  if (process.env.DB_MIGRATE_ON_BOOT !== 'false') {
    await runPendingMigrations();
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Branch-Id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  /*
   * The Inngest serve handler, when the worker runs in this process.
   *
   * Mounted after the pipes but it makes no difference: `serve()` is raw
   * Express middleware attached with `app.use()`, so it sits outside Nest's
   * router entirely — no guard, no pipe, and no global prefix applies to it.
   * Its path is literally `/api/inngest`.
   *
   * Skipped when `WORKER_INLINE=false`, because then a separate worker process
   * owns the functions and two processes serving the same app id would fight
   * over which one Inngest syncs to.
   */
  if (process.env.WORKER_INLINE !== 'false') {
    // Inngest POSTs function payloads here, which can exceed Express's 100kb
    // default once an email body is in flight.
    app.useBodyParser('json', { limit: '10mb' });
    mountInngest(app);
  }

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`SFA API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
