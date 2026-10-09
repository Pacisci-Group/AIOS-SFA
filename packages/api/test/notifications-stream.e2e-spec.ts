import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import type { NotificationRecord } from '@sfa/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Model, Types } from 'mongoose';
import { App } from 'supertest/types';
import { NotificationBus } from '../src/common/redis/notification-bus';
import { NotificationsService } from '../src/notifications/notifications.service';
import { Notification } from '../src/notifications/schemas/notification.schema';
import { NotificationStreamRegistry } from '../src/notifications/stream/notification-stream.registry';
import { User } from '../src/users/schemas/user.schema';
import { login } from './helpers/auth.helper';
import {
  seedTestData,
  TEST_PASSWORD,
  type TestSeedContext,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

/** One parsed Server-Sent Events frame. */
interface SseFrame {
  event: string;
  id: string | null;
  data: string;
}

/**
 * Reads frames off a `fetch` response body, one blank-line-delimited block at
 * a time. Deliberately tiny: only what the assertions below need.
 */
class SseReader {
  private readonly decoder = new TextDecoder();
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = '';
  private readonly frames: SseFrame[] = [];
  /** Resolves when the server ends the response. */
  readonly done: Promise<void>;
  private ended = false;

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
    this.done = this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value, { stream: true });
        this.drain();
      }
    } catch {
      // An aborted body rejects; for these tests that is an end like any other.
    } finally {
      this.ended = true;
    }
  }

  private drain(): void {
    let index: number;
    while ((index = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      if (!block.trim()) continue;
      const frame: SseFrame = { event: 'message', id: null, data: '' };
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) frame.event = line.slice(6).trim();
        else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
        else if (line.startsWith('data:'))
          dataLines.push(line.slice(5).trimStart());
      }
      frame.data = dataLines.join('\n');
      this.frames.push(frame);
    }
  }

  /** The next frame of the given event type, or a rejection on timeout. */
  async next(event: string, timeoutMs = 5_000): Promise<SseFrame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.frames.findIndex((frame) => frame.event === event);
      if (index !== -1) return this.frames.splice(index, 1)[0];
      if (this.ended)
        throw new Error(`Stream ended before a '${event}' frame.`);
      if (Date.now() > deadline)
        throw new Error(`No '${event}' frame in ${timeoutMs}ms.`);
      await sleep(25);
    }
  }

  /** True when no frame of that type arrives within the window. */
  async none(event: string, windowMs: number): Promise<boolean> {
    await sleep(windowMs);
    return !this.frames.some((frame) => frame.event === event);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time.');
    await sleep(25);
  }
}

/**
 * The live stream (PAC-154 PR2).
 *
 * Needs a real socket — supertest cannot hold a response open — so the app
 * listens on an ephemeral port and Node's `fetch` reads the body. The bus is
 * the in-process one (`setup-env.ts` pins `REDIS_URL=''`), which is the same
 * graph `api:dev` runs; cross-process fan-out is Redis's contract, verified by
 * hand with two API processes (see the PR).
 */
describe('Notifications stream (PAC-154 PR2)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let baseUrl: string;
  let producerToken: string;
  let producerId: string;
  let csrId: string;
  let model: Model<Notification>;
  let bus: NotificationBus;
  let registry: NotificationStreamRegistry;
  const controllers: AbortController[] = [];

  async function seedRow(recipientId: string, title: string): Promise<string> {
    const row = await model.create({
      recipientId: new Types.ObjectId(recipientId),
      agencyId: null,
      type: 'bug_report.filed',
      title,
      body: 'Body',
      href: '/admin/bugs',
      entity: { kind: 'bugReport', id: 'entity' },
      actorId: null,
      data: {},
      readAt: null,
      dedupeKey: `stream:${recipientId}:${title}`,
    });
    return row._id.toHexString();
  }

  async function open(token: string): Promise<{
    res: Response;
    reader: SseReader;
    controller: AbortController;
  }> {
    const controller = new AbortController();
    controllers.push(controller);
    const res = await fetch(`${baseUrl}/notifications/stream`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Stream refused: ${res.status}`);
    }
    return { res, reader: new SseReader(res.body), controller };
  }

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    await app.listen(0);
    const server = app.getHttpServer() as unknown as Server;
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;

    model = app.get<Model<Notification>>(getModelToken(Notification.name));
    bus = app.get(NotificationBus);
    registry = app.get(NotificationStreamRegistry);

    producerToken = (await login(app, ctx.producerEmail, TEST_PASSWORD))
      .accessToken;
    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const producer = await userModel
      .findOne({ email: ctx.producerEmail })
      .lean();
    producerId = producer!._id.toString();
    csrId = ctx.csrUserId;
  });

  afterEach(async () => {
    for (const controller of controllers.splice(0)) controller.abort();
    await waitFor(() => registry.size() === 0).catch(() => undefined);
    await model.deleteMany({});
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('requires a session', async () => {
    const res = await fetch(`${baseUrl}/notifications/stream`);
    expect(res.status).toBe(401);
  });

  it('opens with a ready frame and the SSE headers', async () => {
    const { res, reader } = await open(producerToken);

    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const ready = await reader.next('ready');
    expect(ready.event).toBe('ready');
    expect(registry.size(producerId)).toBe(1);
  });

  it('streams the stored row when the bus nudges the caller', async () => {
    const { reader } = await open(producerToken);
    await reader.next('ready');

    const notificationId = await seedRow(producerId, 'Live row');
    await bus.publish({ recipientId: producerId, notificationId });

    const frame = await reader.next('notification');
    expect(frame.id).toBe(notificationId);
    const record = JSON.parse(frame.data) as NotificationRecord;
    expect(record).toMatchObject({
      id: notificationId,
      title: 'Live row',
      href: '/admin/bugs',
      readAt: null,
    });
  });

  it('drops the frame, not the stream, when a row read fails — and never the error text', async () => {
    const { reader } = await open(producerToken);
    await reader.next('ready');

    // A transient driver failure on one re-read. Without the per-nudge
    // `catchError` this errors the merged observable: Nest writes
    // `{ type: 'error', data: err.message }` to the client and ends the
    // response.
    const service = app.get(NotificationsService);
    const failing = jest
      .spyOn(service, 'findForStream')
      .mockRejectedValueOnce(
        new Error('connection 3 to 10.0.0.7:27017 closed'),
      );
    try {
      const lost = await seedRow(producerId, 'Lost frame');
      await bus.publish({ recipientId: producerId, notificationId: lost });

      await expect(reader.none('error', 300)).resolves.toBe(true);
      expect(registry.size(producerId)).toBe(1);

      // The stream is still live: the next nudge arrives as normal.
      const kept = await seedRow(producerId, 'Kept frame');
      await bus.publish({ recipientId: producerId, notificationId: kept });
      const frame = await reader.next('notification');
      expect(frame.id).toBe(kept);
    } finally {
      failing.mockRestore();
    }
  });

  it("drops a nudge for another user, and one for a row that is not the caller's", async () => {
    const { reader } = await open(producerToken);
    await reader.next('ready');

    const csrRow = await seedRow(csrId, 'Not yours');
    // Addressed to the CSR: never routed to the producer's stream.
    await bus.publish({ recipientId: csrId, notificationId: csrRow });
    // Mis-addressed: routed, but the re-read is scoped to the caller.
    await bus.publish({ recipientId: producerId, notificationId: csrRow });

    await expect(reader.none('notification', 400)).resolves.toBe(true);
  });

  it('feeds every open stream of the same user', async () => {
    const one = await open(producerToken);
    const two = await open(producerToken);
    await one.reader.next('ready');
    await two.reader.next('ready');
    expect(registry.size(producerId)).toBe(2);

    const notificationId = await seedRow(producerId, 'Both tabs');
    await bus.publish({ recipientId: producerId, notificationId });

    expect((await one.reader.next('notification')).id).toBe(notificationId);
    expect((await two.reader.next('notification')).id).toBe(notificationId);
  });

  it('forgets the stream when the client goes away', async () => {
    const { reader, controller } = await open(producerToken);
    await reader.next('ready');
    expect(registry.size(producerId)).toBe(1);

    controller.abort();

    await waitFor(() => registry.size(producerId) === 0);
  });

  it("ends the stream at the token's exp", async () => {
    // The same claims the login minted, re-signed to die in three seconds.
    const jwt = app.get(JwtService);
    const claims = jwt.decode<Record<string, unknown>>(producerToken);
    delete claims.iat;
    delete claims.exp;
    const shortLived = jwt.sign(claims, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: '3s',
    });

    const startedAt = Date.now();
    const { reader } = await open(shortLived);
    await reader.next('ready');

    await Promise.race([
      reader.done,
      sleep(6_000).then(() => {
        throw new Error('Stream outlived the token.');
      }),
    ]);
    // Closed about a second early, never late.
    expect(Date.now() - startedAt).toBeLessThan(3_500);
    await waitFor(() => registry.size(producerId) === 0);
  });
});
