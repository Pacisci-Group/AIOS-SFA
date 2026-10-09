import { EventEmitter } from 'node:events';
import type Redis from 'ioredis';
import type { NotificationNudge } from './notification-bus';
import {
  NOTIFICATION_CHANNEL,
  RedisNotificationBus,
} from './redis-notification-bus';

/**
 * The slice of ioredis the bus touches: an EventEmitter that answers
 * `publish`, `subscribe`, `quit` and `disconnect`. Connection state is driven
 * by the test emitting `ready`, exactly as ioredis does after each successful
 * (re)connect.
 */
class FakeConnection extends EventEmitter {
  publish = jest.fn<Promise<number>, [string, string]>(() =>
    Promise.resolve(1),
  );
  subscribe = jest.fn<Promise<number>, [string]>(() => Promise.resolve(1));
  quit = jest.fn(() => Promise.resolve('OK'));
  disconnect = jest.fn();
}

/** The publishing client; `duplicate()` hands out one subscriber connection. */
class FakeRedis extends FakeConnection {
  readonly duplicated = new FakeConnection();
  duplicate = jest.fn((): FakeConnection => this.duplicated);
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function nudge(id = 'n1'): NotificationNudge {
  return { recipientId: '507f1f77bcf86cd799439011', notificationId: id };
}

describe('RedisNotificationBus', () => {
  let client: FakeRedis;
  let bus: RedisNotificationBus;

  beforeEach(() => {
    client = new FakeRedis();
    bus = new RedisNotificationBus(client as unknown as Redis);
  });

  afterEach(async () => {
    await bus.close();
  });

  describe('subscriber connection', () => {
    it('opens one duplicate connection however many handlers register', () => {
      bus.subscribe(() => undefined);
      bus.subscribe(() => undefined);

      expect(client.duplicate).toHaveBeenCalledTimes(1);
    });

    it('does not SUBSCRIBE until the connection is ready', () => {
      bus.subscribe(() => undefined);

      expect(client.duplicated.subscribe).not.toHaveBeenCalled();

      client.duplicated.emit('ready');

      expect(client.duplicated.subscribe).toHaveBeenCalledTimes(1);
      expect(client.duplicated.subscribe).toHaveBeenCalledWith(
        NOTIFICATION_CHANNEL,
      );
    });

    // The PR2 review finding: ioredis only replays channels it has a
    // successful SUBSCRIBE reply for, so a SUBSCRIBE lost while the connection
    // was coming up would never be retried. Re-asserting on every `ready`
    // means a reconnect — or a first connection that failed a few times —
    // always ends subscribed.
    it('re-issues SUBSCRIBE on every ready, so a reconnect re-asserts the channel', () => {
      bus.subscribe(() => undefined);

      client.duplicated.emit('ready');
      client.duplicated.emit('ready');
      client.duplicated.emit('ready');

      expect(client.duplicated.subscribe).toHaveBeenCalledTimes(3);
    });

    it('survives a rejected SUBSCRIBE and tries again on the next ready', async () => {
      client.duplicated.subscribe.mockRejectedValueOnce(
        new Error('MaxRetriesPerRequestError'),
      );
      bus.subscribe(() => undefined);

      client.duplicated.emit('ready');
      await flush();
      client.duplicated.emit('ready');
      await flush();

      expect(client.duplicated.subscribe).toHaveBeenCalledTimes(2);
    });

    it('logs a connection error instead of letting the emitter throw', () => {
      bus.subscribe(() => undefined);

      // An EventEmitter with no 'error' listener throws on emit; the bus must
      // have attached one so a failed reconnect cannot take the process down.
      expect(() =>
        client.duplicated.emit('error', new Error('ECONNREFUSED')),
      ).not.toThrow();
    });

    it('closes the duplicate, not the publishing client', async () => {
      bus.subscribe(() => undefined);

      await bus.close();

      expect(client.duplicated.quit).toHaveBeenCalledTimes(1);
      expect(client.quit).not.toHaveBeenCalled();
    });
  });

  describe('messages', () => {
    it('hands a nudge on the channel to every handler', () => {
      const one: NotificationNudge[] = [];
      const two: NotificationNudge[] = [];
      bus.subscribe((n) => one.push(n));
      bus.subscribe((n) => two.push(n));

      client.duplicated.emit(
        'message',
        NOTIFICATION_CHANNEL,
        JSON.stringify(nudge('abc')),
      );

      expect(one).toEqual([nudge('abc')]);
      expect(two).toEqual([nudge('abc')]);
    });

    it('ignores other channels, unparseable bodies and foreign shapes', () => {
      const received: NotificationNudge[] = [];
      bus.subscribe((n) => received.push(n));

      client.duplicated.emit('message', 'other', JSON.stringify(nudge()));
      client.duplicated.emit('message', NOTIFICATION_CHANNEL, '{not json');
      client.duplicated.emit(
        'message',
        NOTIFICATION_CHANNEL,
        JSON.stringify({ hello: 'world' }),
      );

      expect(received).toEqual([]);
    });

    it('stops delivering to a handler once it unsubscribes', () => {
      const received: NotificationNudge[] = [];
      const off = bus.subscribe((n) => received.push(n));
      off();

      client.duplicated.emit(
        'message',
        NOTIFICATION_CHANNEL,
        JSON.stringify(nudge()),
      );

      expect(received).toEqual([]);
    });

    it('one throwing handler does not stop the others being told', () => {
      const received: NotificationNudge[] = [];
      bus.subscribe(() => {
        throw new Error('bug in a registry');
      });
      bus.subscribe((n) => received.push(n));

      client.duplicated.emit(
        'message',
        NOTIFICATION_CHANNEL,
        JSON.stringify(nudge()),
      );

      expect(received).toHaveLength(1);
    });
  });

  describe('publish', () => {
    it('PUBLISHes the nudge as JSON on the channel', async () => {
      await bus.publish(nudge('xyz'));

      expect(client.publish).toHaveBeenCalledWith(
        NOTIFICATION_CHANNEL,
        JSON.stringify(nudge('xyz')),
      );
    });

    it('swallows a failed PUBLISH — lossy by contract, the row is the truth', async () => {
      client.publish.mockRejectedValueOnce(new Error('Connection is closed.'));

      await expect(bus.publish(nudge())).resolves.toBeUndefined();
    });
  });
});
