import { DataScope } from '@sfa/shared';
import { Types } from 'mongoose';

/**
 * A role as the API returns it.
 *
 * Declared explicitly rather than inferred from `lean()`: Mongoose's hydrated
 * document types are large enough that TypeScript refuses to serialize the
 * inferred shape ("exceeds the maximum length the compiler will serialize"),
 * and an explicit contract is what the web codes against anyway.
 *
 * `permissions` is assembled from the `rolePermissions` join — it is no longer a
 * field on the document — so the wire shape is unchanged by the relational
 * refactor.
 */
export interface RoleResponse {
  _id: Types.ObjectId;
  agencyId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
  dataScope: DataScope;
  isSystemTemplate: boolean;
  grantsAllEnabledModules: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A role in a list, with how many people hold it. */
export interface RoleListItem extends RoleResponse {
  userCount: number;
}
