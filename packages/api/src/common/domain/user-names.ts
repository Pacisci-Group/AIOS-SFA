import { Model, Types } from 'mongoose';
import type { UserDocument } from '../../users/schemas/user.schema';

/**
 * Display names for a set of user ids, **deactivated users included**: someone
 * who sold in March and left in June still sold in March, and dropping their
 * row would make a table's total disagree with the card above it.
 *
 * Falls back to the local part of the email for a user with no name on file.
 * Lifted from `OwnerDashboardService` when the Manager view (PAC-139) became
 * the second dashboard naming producers off a `$group` key.
 */
export async function displayNamesFor(
  userModel: Model<UserDocument>,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const users = await userModel
    .find(
      { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
      { firstName: 1, lastName: 1, email: 1 },
    )
    .lean<
      {
        _id: Types.ObjectId;
        firstName?: string;
        lastName?: string;
        email: string;
      }[]
    >();

  return new Map(users.map((user) => [user._id.toString(), displayName(user)]));
}

/** "Pat Producer", or the email's local part when no name is on file. */
export function displayName(user: {
  firstName?: string;
  lastName?: string;
  email: string;
}): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email.split('@')[0];
}
