import type { NotificationRecord } from '@sfa/shared';
import { firstValueFrom, toArray } from 'rxjs';
import type { Subscription } from 'rxjs';
import { LocalNotificationBus } from '../../common/redis/local-notification-bus';
import type { NotificationNudge } from '../../common/redis/notification-bus';
import type { NotificationsService } from '../notifications.service';
import {
  MAX_STREAMS_PER_USER,
  NotificationStreamRegistry,
} from './notification-stream.registry';

const ALICE = '507f1f77bcf86cd799439011';
const BOB = '507f1f77bcf86cd799439012';

function nudge(recipientId: string, notificationId = 'n1'): NotificationNudge {
  return { recipientId, notificationId };
}

function record(id: string): NotificationRecord {
  return {
    id,
    type: 'bug_report.filed',
    title: `Row ${id}`,
    body: 'Body',
    href: '/admin/bugs',
    entity: { kind: 'bugReport', id: 'entity' },
    actorId: null,
    agencyId: null,
    data: {},
    readAt: null,
    createdAt: new Date(0).toISOString(),
  };
}

/** Rows the fake service knows, keyed by id; a read for another user is null. */
function fakeService(rows: Array<{ id: string; recipientId: string }>) {
  const findForStream = jest.fn(
    (id: string, userId: string): Promise<NotificationRecord | null> => {
      const row = rows.find((r) => r.id === id && r.recipientId === userId);
      return Promise.resolve(row ? record(row.id) : null);
    },
  );
  return {
    findForStream,
    service: { findForStream } as unknown as NotificationsService,
  };
}

/** Let the registry's async dispatch settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('NotificationStreamRegistry', () => {
  let bus: LocalNotificationBus;
  let registry: NotificationStreamRegistry;
  let findForStream: jest.Mock;
  const subscriptions: Subscription[] = [];

  /** Subscribe and collect, remembering the subscription for cleanup. */
  function listen(userId: string): { received: NotificationRecord[] } {
    const received: NotificationRecord[] = [];
    subscriptions.push(
      registry.open(userId).subscribe((row) => {
        received.push(row);
      }),
    );
    return { received };
  }

  beforeEach(() => {
    bus = new LocalNotificationBus();
    const fake = fakeService([
      { id: 'for-alice', recipientId: ALICE },
      { id: 'for-bob', recipientId: BOB },
    ]);
    findForStream = fake.findForStream;
    registry = new NotificationStreamRegistry(bus, fake.service);
    registry.onModuleInit();
  });

  afterEach(() => {
    for (const subscription of subscriptions.splice(0)) {
      subscription.unsubscribe();
    }
    registry.onModuleDestroy();
  });

  it('registers a stream only once something subscribes, and removes it on unsubscribe', () => {
    const observable = registry.open(ALICE);
    expect(registry.size(ALICE)).toBe(0);

    const subscription = observable.subscribe();
    expect(registry.size(ALICE)).toBe(1);
    expect(registry.size()).toBe(1);

    subscription.unsubscribe();
    expect(registry.size(ALICE)).toBe(0);
    expect(registry.size()).toBe(0);
  });

  it('routes a nudge from the bus to the recipient, as the stored row, and to nobody else', async () => {
    const alice = listen(ALICE);
    const bob = listen(BOB);

    await bus.publish(nudge(ALICE, 'for-alice'));
    await settle();

    expect(alice.received.map((row) => row.id)).toEqual(['for-alice']);
    expect(bob.received).toEqual([]);
  });

  it('reads the row once per nudge and feeds every open stream of the same user', async () => {
    const tabOne = listen(ALICE);
    const tabTwo = listen(ALICE);
    expect(registry.size(ALICE)).toBe(2);

    await bus.publish(nudge(ALICE, 'for-alice'));
    await settle();

    expect(tabOne.received).toHaveLength(1);
    expect(tabTwo.received).toHaveLength(1);
    expect(tabOne.received[0]).toBe(tabTwo.received[0]);
    // One read for the user, however many tabs (PR2 review).
    expect(findForStream).toHaveBeenCalledTimes(1);
    expect(findForStream).toHaveBeenCalledWith('for-alice', ALICE);
  });

  it('never reads for a user with no stream on this node', async () => {
    const alice = listen(ALICE);

    await bus.publish(nudge(BOB, 'for-bob'));
    await settle();

    expect(alice.received).toEqual([]);
    expect(registry.size(BOB)).toBe(0);
    expect(findForStream).not.toHaveBeenCalled();
  });

  it("drops a nudge for a row that is not the recipient's", async () => {
    const alice = listen(ALICE);

    // Mis-addressed: routed to Alice, but the scoped read finds nothing.
    await bus.publish(nudge(ALICE, 'for-bob'));
    await settle();

    expect(alice.received).toEqual([]);
  });

  it('drops the frame, not the stream, when the read fails', async () => {
    const alice = listen(ALICE);
    findForStream.mockRejectedValueOnce(
      new Error('connection 3 to 10.0.0.7:27017 closed'),
    );

    await bus.publish(nudge(ALICE, 'for-alice'));
    await settle();
    expect(alice.received).toEqual([]);
    expect(registry.size(ALICE)).toBe(1);

    await bus.publish(nudge(ALICE, 'for-alice'));
    await settle();
    expect(alice.received).toHaveLength(1);
  });

  it('does not leak: after the last stream closes, a nudge reaches nothing', async () => {
    const alice = listen(ALICE);
    subscriptions.pop()!.unsubscribe();

    await bus.publish(nudge(ALICE, 'for-alice'));
    await settle();

    expect(alice.received).toEqual([]);
    expect(registry.size()).toBe(0);
  });

  it(`admits ${MAX_STREAMS_PER_USER} streams per user and refuses the next`, () => {
    for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) {
      expect(registry.canOpen(ALICE)).toBe(true);
      listen(ALICE);
    }
    expect(registry.canOpen(ALICE)).toBe(false);
    // Another user is counted on their own.
    expect(registry.canOpen(BOB)).toBe(true);

    subscriptions.pop()!.unsubscribe();
    expect(registry.canOpen(ALICE)).toBe(true);
  });

  it('completes every open stream, fires closed$, and stops listening to the bus on destroy', async () => {
    const collected = firstValueFrom(registry.open(ALICE).pipe(toArray()));
    const closed = firstValueFrom(registry.closed$.pipe(toArray()));

    registry.onModuleDestroy();
    await expect(collected).resolves.toEqual([]);
    // One emission, then complete — what `takeUntil` needs.
    await expect(closed).resolves.toEqual([undefined]);

    // Listening again after destroy: the bus subscription is gone, so a
    // publish reaches nothing even though a Subject is registered.
    const late = listen(ALICE);
    await bus.publish(nudge(ALICE, 'for-alice'));
    await settle();
    expect(late.received).toEqual([]);
  });
});
