import { firstValueFrom, toArray } from 'rxjs';
import type { Subscription } from 'rxjs';
import { LocalNotificationBus } from '../../common/redis/local-notification-bus';
import type { NotificationNudge } from '../../common/redis/notification-bus';
import { NotificationStreamRegistry } from './notification-stream.registry';

const ALICE = '507f1f77bcf86cd799439011';
const BOB = '507f1f77bcf86cd799439012';

function nudge(recipientId: string, notificationId = 'n1'): NotificationNudge {
  return { recipientId, notificationId };
}

describe('NotificationStreamRegistry', () => {
  let bus: LocalNotificationBus;
  let registry: NotificationStreamRegistry;
  const subscriptions: Subscription[] = [];

  /** Subscribe and collect, remembering the subscription for cleanup. */
  function listen(userId: string): { received: NotificationNudge[] } {
    const received: NotificationNudge[] = [];
    subscriptions.push(
      registry.open(userId).subscribe((n) => {
        received.push(n);
      }),
    );
    return { received };
  }

  beforeEach(() => {
    bus = new LocalNotificationBus();
    registry = new NotificationStreamRegistry(bus);
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

  it('routes a nudge from the bus to the recipient and to nobody else', async () => {
    const alice = listen(ALICE);
    const bob = listen(BOB);

    await bus.publish(nudge(ALICE, 'for-alice'));

    expect(alice.received).toEqual([nudge(ALICE, 'for-alice')]);
    expect(bob.received).toEqual([]);
  });

  it('feeds every open stream of the same user — one per tab', async () => {
    const tabOne = listen(ALICE);
    const tabTwo = listen(ALICE);
    expect(registry.size(ALICE)).toBe(2);

    await bus.publish(nudge(ALICE));

    expect(tabOne.received).toHaveLength(1);
    expect(tabTwo.received).toHaveLength(1);
  });

  it('drops a nudge for a user with no stream on this node', async () => {
    const alice = listen(ALICE);

    await bus.publish(nudge(BOB));

    expect(alice.received).toEqual([]);
    expect(registry.size(BOB)).toBe(0);
  });

  it('does not leak: after the last stream closes, a nudge reaches nothing', async () => {
    const alice = listen(ALICE);
    subscriptions.pop()!.unsubscribe();

    await bus.publish(nudge(ALICE));

    expect(alice.received).toEqual([]);
    expect(registry.size()).toBe(0);
  });

  it('completes every open stream and stops listening to the bus on destroy', async () => {
    const collected = firstValueFrom(registry.open(ALICE).pipe(toArray()));

    registry.onModuleDestroy();
    await expect(collected).resolves.toEqual([]);

    // Listening again after destroy: the bus subscription is gone, so a
    // publish reaches nothing even though a Subject is registered.
    const late = listen(ALICE);
    await bus.publish(nudge(ALICE));
    expect(late.received).toEqual([]);
  });
});
