import type { FilterQuery } from 'mongoose';
import { searchTokens } from '@sfa/shared';
import { escapeRegex } from './escape-regex';

/**
 * Mongo filters for the free-text search boxes (PAC-101).
 *
 * The pure half of the rule — how a query becomes tokens — lives in
 * `@sfa/shared/domain/search-terms`, because the web tokenizes too. This is the
 * half that only the server needs: turning those tokens into a filter.
 *
 * The shape is always the same:
 *
 * ```
 * "smith tulsa" -> $and: [ {$or: [f1~smith, f2~smith, …]},
 *                          {$or: [f1~tulsa, f2~tulsa, …]} ]
 * ```
 *
 * **AND across tokens, OR across fields.** Every token must appear somewhere,
 * but not necessarily in the same field — which is exactly what makes
 * `smith tulsa` find a Smith in Tulsa, and what makes `John Smith` match a
 * record split across `firstName` and `lastName` in either order without an
 * `$expr`/`$concat` stage.
 *
 * ## Cost
 *
 * A case-insensitive *contains* regex is a scan; no index serves one. That is a
 * deliberate trade, argued in full on `PlatformUsersService` — a `$text` index
 * would break partial matching, since `$text` is whole-word, so `auth` would
 * miss `authentication`. Three things keep the scan bounded, and every caller
 * must preserve all three:
 *
 * 1. **The tenancy key stays outside the search.** `agencyId` / `campaignId`
 *    is an equality the planner can seek on, so the scan covers one tenant's
 *    index range rather than the collection. Never fold it into the `$or`.
 * 2. **Tokens are capped** at `MAX_SEARCH_TOKENS`, so cost is bounded at
 *    `tokens × fields` rather than growing with what someone pasted.
 * 3. **Child-collection resolution is capped**, the way `CHILD_MATCH_CAP` and
 *    `CONTACT_MATCH_CAP` already do it — a broad term returns the first page of
 *    matches rather than building an unbounded `$in`.
 */

/**
 * A clause no document satisfies — an explicit empty result.
 *
 * The distinction this exists for: **"resolved to nothing" is not "no
 * filter".** A role filter matching no role, or a name matching no contact,
 * must yield an empty page — collapsing to unfiltered would silently hand back
 * the whole collection as if everything had matched. Two services had written
 * this constant independently; it is one definition now.
 */
export const MATCHES_NOTHING = { _id: { $in: [] as never[] } };

/**
 * One token as a case-insensitive *contains*.
 *
 * Unanchored on purpose. The mailer records table anchored this with `^` and so
 * could never match `SMITH` against a `lastName` of `'ANN SMITH'` — and, once a
 * full name was pasted, could never match anything at all.
 */
export function tokenRegex(token: string): {
  $regex: string;
  $options: string;
} {
  return { $regex: escapeRegex(token), $options: 'i' };
}

/**
 * Match a stored phone against a digits-only query, whatever format it was
 * saved in.
 *
 * `5551234` becomes `5\D*5\D*5\D*1\D*2\D*3\D*4`, so it hits `(555) 123-4xxx`
 * and `555.1234` alike. The input is digits only, so the pattern is
 * injection-safe by construction — but it is still only safe to run under a
 * tenancy key, which keeps it to one agency's index range.
 */
export function phoneDigitsRegex(digits: string): string {
  return digits.split('').join('\\D*');
}

/**
 * Extra `$or` branches for one token, beyond the plain field matches — a
 * child-collection lookup resolved to ids, typically.
 *
 * Returning `null` means "this token has nothing to add here", which is not the
 * same as `MATCHES_NOTHING`: the token may still match a plain field.
 */
export type TokenBranchResolver<T> = (
  token: string,
) => Promise<FilterQuery<T> | null>;

/**
 * The AND-of-ORs for a set of fields, or `null` for a query with nothing
 * searchable in it.
 *
 * `null` rather than `MATCHES_NOTHING` is load-bearing: `?q=` is what a cleared
 * input sends, and it has to reach the caller as "no filter". Read as an
 * impossible filter, clearing the search box would empty the table.
 */
export function tokenizedOr<T>(
  raw: unknown,
  fields: readonly string[],
): FilterQuery<T> | null {
  const tokens = searchTokens(raw);
  if (!tokens.length || !fields.length) return null;

  return {
    $and: tokens.map((token) => ({
      $or: fields.map((field) => ({ [field]: tokenRegex(token) })),
    })),
  } as FilterQuery<T>;
}

/**
 * {@link tokenizedOr}, plus per-token branches that need a query of their own —
 * a contact's email, an agency's name, a branch's name.
 *
 * Resolvers run **once per token** and all in parallel, so a four-token query
 * costs at most `tokens × resolvers` small indexed lookups, resolved in one
 * round of `Promise.all` rather than serially. Each resolver is responsible for
 * its own cap.
 *
 * `extraFieldsOnly` tokens are still ORed with the plain fields — a resolver
 * that finds nothing removes a branch, it never removes the token.
 */
export async function tokenizedOrAsync<T>(
  raw: unknown,
  fields: readonly string[],
  resolvers: readonly TokenBranchResolver<T>[] = [],
): Promise<FilterQuery<T> | null> {
  const tokens = searchTokens(raw);
  if (!tokens.length) return null;

  const resolved = await Promise.all(
    tokens.map((token) =>
      Promise.all(resolvers.map((resolve) => resolve(token))),
    ),
  );

  const clauses = tokens.map((token, index) => {
    const or: FilterQuery<T>[] = fields.map(
      (field) => ({ [field]: tokenRegex(token) }) as FilterQuery<T>,
    );
    for (const branch of resolved[index]) {
      if (branch) or.push(branch);
    }
    return { $or: or };
  });

  // Every token resolved to an empty `$or` — possible only when `fields` is
  // empty and no resolver matched. That is a real "nothing matches", not "no
  // filter": the caller did supply a query.
  if (clauses.every((clause) => clause.$or.length === 0)) {
    return MATCHES_NOTHING;
  }

  return { $and: clauses };
}
