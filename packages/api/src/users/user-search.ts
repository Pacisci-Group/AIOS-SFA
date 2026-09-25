import type { FilterQuery, Model, Types } from 'mongoose';

/**
 * Pieces shared by the two user directories (PAC-101).
 *
 * `GET /platform/users` (every agency) and `GET /users` (one agency) render
 * nearly the same row and must therefore search nearly the same things. They
 * are separate services for good reasons — different tenancy, different
 * permissions, different enrichment — but the *searched field set* drifting
 * between them is exactly the defect this ticket is about, so the parts that
 * must agree live here.
 */

/**
 * The user fields both directories match free text against.
 *
 * Only what lives on the `users` document itself. Agency, branch and role are
 * names on *other* collections and are resolved to ids first — see
 * {@link idsMatching} — because `users` carries no name for any of them.
 *
 * `status` is not here and must not be: it is derived from `isActive` +
 * `deactivatedAt` rather than stored, and substring-matching a derived label
 * would make `act` match both "active" and "deactivated". It is a facet.
 */
export const USER_SEARCH_FIELDS = ['firstName', 'lastName', 'email'] as const;

/**
 * How many ids one term may resolve into an `$in`.
 *
 * Same rule and the same reason as `CHILD_MATCH_CAP` on the Clients page and
 * `CONTACT_MATCH_CAP` on Leads: a very broad term returns the first page of
 * matches rather than building an unbounded `$in`.
 */
export const USER_CHILD_MATCH_CAP = 500;

/**
 * The `_id`s of whatever matches, capped — or an empty array.
 *
 * The building block for "search by a name that lives on another collection":
 * resolve that collection to ids, then match the `users` query against them.
 * Two phases rather than one `$lookup` pipeline, which is the standing choice
 * here — it keeps the paged query index-friendly on `agencyId` and is far
 * easier to reason about when a filter combination misbehaves.
 *
 * ⚠ An empty result is **not** "no filter". The caller decides what nothing
 * means: as one branch of an `$or` it should be dropped, but as the whole of a
 * required filter it must become `MATCHES_NOTHING`.
 *
 * ⚠ **Pass `D` explicitly** — `idsMatching<AgencyDocument>(this.agencyModel, …)`.
 * Left to infer, TypeScript resolves `D` to the plain schema class rather than
 * the hydrated document type and then rejects the model as unassignable, in one
 * of Mongoose's less legible errors.
 */
export async function idsMatching<D>(
  model: Model<D>,
  filter: FilterQuery<D>,
  cap: number = USER_CHILD_MATCH_CAP,
): Promise<Types.ObjectId[]> {
  const rows = await model
    .find(filter)
    .select({ _id: 1 })
    .limit(cap)
    .lean<Array<{ _id: Types.ObjectId }>>();
  return rows.map((row) => row._id);
}
