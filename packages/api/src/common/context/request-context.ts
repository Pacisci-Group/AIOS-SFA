import { AsyncLocalStorage } from 'node:async_hooks';
import { Types } from 'mongoose';

/**
 * Per-request ambient state, for the few things that genuinely cannot be
 * threaded through a call signature (PAC-72).
 *
 * Today that is exactly one thing: **who is writing**, so `createdBy` /
 * `updatedBy` can be stamped by a Mongoose plugin rather than by every write
 * site remembering to pass an actor. See `authorship.plugin.ts`.
 *
 * ⚠ Resist growing this. Ambient state is invisible at the call site, which is
 * the whole point here and the whole danger everywhere else — `AccessContext`
 * is passed explicitly precisely so an authorization decision can never depend
 * on something a reader cannot see.
 */
export interface RequestContextStore {
  /**
   * The authenticated caller.
   *
   * Deliberately **mutable and initially absent**. `RequestContextMiddleware`
   * opens the store, but Nest runs middleware *before* guards, so there is no
   * authenticated user yet at that point — `AccessContextGuard` fills this in
   * once it has resolved one. Anything running outside a request (migration,
   * seeds, the worker) has no store at all and reads as "system".
   */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Run `fn` inside a fresh request store.
 *
 * Must wrap the request synchronously — every async continuation started inside
 * `fn` inherits the store, but nothing started outside it does. This is why the
 * store is opened by middleware and not, say, by an interceptor returning an
 * observable: the observable would be *created* inside the context and
 * *subscribed* outside it, leaving every handler unattributed.
 */
export function runWithRequestContext<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** Record the authenticated caller on the active store, if there is one. */
export function setRequestUserId(userId: string): void {
  const store = storage.getStore();
  if (store) {
    store.userId = userId;
  }
}

/**
 * The acting user as an ObjectId, or `null` outside a request.
 *
 * `null` is a real answer, not a failure: migration-, seed- and worker-written
 * records genuinely have no author, and null reads as "system". Never
 * substitute a placeholder id to fill the column.
 */
export function currentUserObjectId(): Types.ObjectId | null {
  const userId = storage.getStore()?.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    return null;
  }
  return new Types.ObjectId(userId);
}

/**
 * Authorship fields for a write the {@link authorshipPlugin} cannot reach —
 * `bulkWrite` operations, which bypass Mongoose middleware entirely.
 *
 * Returns an empty object outside a request, so spreading it is always safe.
 */
export function authorshipForInsert(): {
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
} {
  const userId = currentUserObjectId();
  return userId ? { createdBy: userId, updatedBy: userId } : {};
}
