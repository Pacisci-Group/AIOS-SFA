import { Types } from 'mongoose';
import {
  authorshipForInsert,
  currentUserObjectId,
  runWithRequestContext,
  setRequestUserId,
} from './request-context';

const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f191e810c19729de860ea';

/**
 * The ambient authorship context (PAC-72).
 *
 * Worth pinning because every failure mode here is silent. A store that does
 * not propagate leaves `createdBy` null on real user writes and looks exactly
 * like migrated data; a store that *leaks* between requests attributes one
 * user's edit to another, which is worse than recording nothing.
 */
describe('request context', () => {
  describe('outside a request', () => {
    it('resolves to null rather than throwing', () => {
      expect(currentUserObjectId()).toBeNull();
    });

    it('yields no authorship fields, so spreading it is a no-op', () => {
      // Migration, seeds and the worker all take this path. `null` is the
      // honest answer — never a placeholder user id.
      expect(authorshipForInsert()).toEqual({});
    });

    it('ignores setRequestUserId instead of opening a store implicitly', () => {
      setRequestUserId(USER_ID);

      expect(currentUserObjectId()).toBeNull();
    });
  });

  describe('inside a request', () => {
    it('starts empty — middleware opens the store before any user is known', () => {
      // Nest runs middleware before guards, so this is the real state for the
      // whole guard chain up to AccessContextGuard.
      runWithRequestContext(() => {
        expect(currentUserObjectId()).toBeNull();
      });
    });

    it('records the caller once the guard resolves one', () => {
      runWithRequestContext(() => {
        setRequestUserId(USER_ID);

        expect(currentUserObjectId()?.toString()).toBe(USER_ID);
      });
    });

    it('returns an ObjectId, not a string', () => {
      // `createdBy` is an ObjectId ref; a string would be cast on save but
      // compared as a mismatch anywhere it is read back.
      runWithRequestContext(() => {
        setRequestUserId(USER_ID);

        expect(currentUserObjectId()).toBeInstanceOf(Types.ObjectId);
      });
    });

    it('stamps both fields for an insert', () => {
      runWithRequestContext(() => {
        setRequestUserId(USER_ID);
        const fields = authorshipForInsert();

        expect(fields.createdBy?.toString()).toBe(USER_ID);
        expect(fields.updatedBy?.toString()).toBe(USER_ID);
      });
    });

    it('degrades to null on a malformed user id', () => {
      runWithRequestContext(() => {
        setRequestUserId('not-an-object-id');

        expect(currentUserObjectId()).toBeNull();
      });
    });

    it('propagates across async boundaries', async () => {
      // The property the whole design rests on: the store has to survive every
      // `await` between the guard and the Mongoose hook.
      await runWithRequestContext(async () => {
        setRequestUserId(USER_ID);
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(currentUserObjectId()?.toString()).toBe(USER_ID);
      });
    });
  });

  describe('isolation', () => {
    it('does not leak between concurrent requests', async () => {
      // Two overlapping requests, interleaved on purpose. A shared store would
      // attribute one user's write to the other.
      const first = runWithRequestContext(async () => {
        setRequestUserId(USER_ID);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentUserObjectId()?.toString();
      });

      const second = runWithRequestContext(async () => {
        setRequestUserId(OTHER_USER_ID);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentUserObjectId()?.toString();
      });

      expect(await Promise.all([first, second])).toEqual([
        USER_ID,
        OTHER_USER_ID,
      ]);
    });

    it('does not leak back out after the request ends', () => {
      runWithRequestContext(() => {
        setRequestUserId(USER_ID);
      });

      expect(currentUserObjectId()).toBeNull();
    });
  });
});
