import { mapWithConcurrency } from './map-with-concurrency';

describe('mapWithConcurrency', () => {
  it('returns results in input order', async () => {
    const out = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n * 5));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it('never has more than `limit` calls in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      4,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
      },
    );
    expect(peak).toBe(4);
  });

  it('handles an empty list and rejects on the first failure', async () => {
    await expect(
      mapWithConcurrency([], 3, () => Promise.resolve(1)),
    ).resolves.toEqual([]);
    await expect(
      mapWithConcurrency([1, 2], 2, (n) =>
        n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n),
      ),
    ).rejects.toThrow('boom');
  });
});
