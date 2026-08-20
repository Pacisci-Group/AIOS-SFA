import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { mountInngest } from './inngest/inngest-serve';

async function bootstrap() {
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
