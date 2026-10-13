import { RateGate } from './rate-gate';

/** A clock the test advances by hand; `sleep` moves it forward. */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      now += ms;
    },
    sleeps,
  };
}

describe('RateGate', () => {
  it('lets `limit` callers through at once and makes the next wait out the window', async () => {
    const clock = fakeClock();
    const gate = new RateGate(2, 1_000, clock.now, clock.sleep);

    await gate.acquire();
    await gate.acquire();
    expect(clock.sleeps).toEqual([]);

    await gate.acquire();
    // The third waited until the first start left the window.
    expect(clock.sleeps).toEqual([1_000]);
    expect(clock.now()).toBe(1_000);
  });

  it('is a sliding window, not a fixed one', async () => {
    const clock = fakeClock();
    const gate = new RateGate(2, 1_000, clock.now, clock.sleep);

    await gate.acquire(); // t=0
    clock.advance(600);
    await gate.acquire(); // t=600
    clock.advance(300); // t=900: both still in the window
    await gate.acquire(); // waits 100 ms for t=0 to leave
    expect(clock.sleeps).toEqual([100]);
    expect(clock.now()).toBe(1_000);
  });

  it('serves callers in the order they asked', async () => {
    const clock = fakeClock();
    const gate = new RateGate(1, 1_000, clock.now, clock.sleep);
    const order: number[] = [];

    await Promise.all([
      gate.acquire().then(() => order.push(1)),
      gate.acquire().then(() => order.push(2)),
      gate.acquire().then(() => order.push(3)),
    ]);

    expect(order).toEqual([1, 2, 3]);
    expect(clock.sleeps).toEqual([1_000, 1_000]);
  });

  it('refuses a zero or negative budget', () => {
    expect(() => new RateGate(0, 1_000)).toThrow();
    expect(() => new RateGate(2, 0)).toThrow();
  });
});
