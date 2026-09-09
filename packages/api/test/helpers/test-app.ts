import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { InngestService } from '../../src/inngest/inngest.service';

/**
 * Records events instead of sending them.
 *
 * `InngestService.send()` makes a real HTTP call to the Inngest event API, so
 * without this every endpoint that emits an event — inviting a user, most
 * obviously — fails with a 500 whenever no Inngest server is listening. That is
 * always the case in CI, and usually the case locally.
 *
 * The stub is applied to every app built by {@link createTestApp}, so a suite
 * only needs its own override when it wants to *assert* on what was emitted
 * (see `invite-event.e2e-spec.ts`).
 *
 * ⚠ This masks a real dependency, which is the point — but it also means these
 * tests prove nothing about whether the event reaches Inngest. That path is
 * covered by the deploy workflow's function-sync check, not here.
 */
export class CapturedInngestService {
  readonly sent: Array<{ name: string; data: Record<string, unknown> }> = [];

  send(event: { name: string }, data: Record<string, unknown>): Promise<void> {
    this.sent.push({ name: event.name, data });
    return Promise.resolve();
  }
}

/** One provider swapped out for a test double. */
export interface ProviderOverride {
  provide: unknown;
  useValue: unknown;
}

export interface CreateTestAppOptions {
  /**
   * Extra providers to replace, applied after the `InngestService` stub.
   *
   * Added for the mailer campaign suites (PAC-71), which need object storage to
   * *work* rather than be absent — see `FakeStorage`. Keep the list short: an
   * app assembled from doubles stops testing the thing it was built to test.
   */
  overrides?: ProviderOverride[];
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(InngestService)
    .useValue(new CapturedInngestService());

  for (const override of options.overrides ?? []) {
    builder = builder
      .overrideProvider(override.provide)
      .useValue(override.useValue);
  }

  const moduleFixture: TestingModule = await builder.compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return app;
}

export async function dropTestDatabase(app: INestApplication): Promise<void> {
  const connection = app.get<Connection>(getConnectionToken());
  await connection.db.dropDatabase();
}

export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.close();
}
