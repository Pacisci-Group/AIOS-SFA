/**
 * `Promise.all(items.map(fn))` with at most `limit` calls in flight.
 *
 * For fan-outs whose per-item cost is a network round trip with a timeout —
 * a push to one device, a row to one recipient. Sequential, a fan-out to
 * sixty users with two devices each and a push service that hangs holds a
 * worker slot for twenty minutes (10 s timeout × 120); unbounded, it opens
 * every socket at once. Order of results matches `items`.
 *
 * The first rejection rejects the whole call, as `Promise.all` does; callers
 * that must not fail fold their errors into the result (`WebPushService`
 * returns an outcome per device and never throws).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!(limit >= 1)) throw new Error('mapWithConcurrency needs a limit ≥ 1');
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
