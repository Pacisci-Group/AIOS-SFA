import { z } from 'zod';

const userId = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{24}$/i, 'Expected a user id.');

/** `POST /users/:userId/work-transfer` and its preview (PAC-136). */
export const workTransferSchema = z.object({
  /** The colleague taking the work on. */
  toUserId: userId,
});

export type WorkTransferDto = z.infer<typeof workTransferSchema>;

/**
 * `DELETE /users/:userId` body (PAC-137). Optional throughout: no body — or no
 * `successorId` — keeps the original release-to-queue behaviour, so existing
 * clients are unaffected.
 */
export const deactivateUserSchema = z
  .object({
    /** Hand the removed person's open work to this colleague instead of releasing it. */
    successorId: userId.optional(),
  })
  .default({});

export type DeactivateUserDto = z.infer<typeof deactivateUserSchema>;
