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
 * ⚠ **Some queries must not be tokenized**, and that is what
 * {@link TermBranchResolver} is for. Splitting on punctuation is what makes
 * `Smith-Jones` searchable as two words, but it also turns `(918) 555-0134`
 * into three tokens too short to look like a phone number. Values that are one
 * indivisible thing — a phone number, a control number — are matched against
 * the raw term and ORed *around* the token clause.
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
 * Address sub-fields, in the order a person reads them.
 *
 * Exported because three collections store an address under different roots and
 * every one of them wants the same four paths searched — restating the list per
 * call site is how one of them ends up missing `zip`.
 */
export const ADDRESS_SUBFIELDS = ['street', 'city', 'state', 'zip'] as const;

/** `addressPaths('address')` -> `['address.street', …]`. */
export function addressPaths(root: string): string[] {
  return ADDRESS_SUBFIELDS.map((field) => `${root}.${field}`);
}

/**
 * An extra `$or` branch for **one token** — typically a child-collection
 * lookup resolved to ids.
 *
 * `null` means "this token has nothing to add here", which is not the same as
 * `MATCHES_NOTHING`: the token may still match a plain field.
 */
export type TokenBranchResolver<T> = (
  token: string,
) => Promise<FilterQuery<T> | null>;

/**
 * An extra `$or` branch for the **whole, untokenized query**.
 *
 * ⚠ This exists because tokenizing destroys some queries. Normalization turns
 * punctuation into a separator — which is what makes `Smith-Jones` searchable
 * as two words — but it also splits `(918) 555-0134` into `918`, `555`, `0134`:
 * three tokens, none of them long enough to look like a phone number, and no
 * lead field that all three appear in. A per-token phone branch can never fire.
 *
 * So anything that reads the query as **one indivisible value** — a phone
 * number, a control number, a policy number — is resolved here instead, from
 * the raw term, and ORed *around* the token clause rather than inside it.
 */
export type TermBranchResolver<T> = (
  raw: string,
) => Promise<FilterQuery<T> | null>;

export interface SearchFilterOptions<T> {
  /** Document paths matched as a case-insensitive contains, per token. */
  fields: readonly string[];
  /** Extra branches resolved once per token, ANDed with the other tokens. */
  tokenBranches?: readonly TokenBranchResolver<T>[];
  /** Extra branches resolved once for the whole term, ORed around the rest. */
  termBranches?: readonly TermBranchResolver<T>[];
}

/**
 * The filter behind one search box, or `null` for a query with nothing
 * searchable in it.
 *
 * ```
 * $or: [ { $and: [ {$or: [f~tok1, …]}, {$or: [f~tok2, …]} ] },  // all tokens
 *        <whole-term branch>,                                    // …or a phone
 *        <whole-term branch> ]                                   // …or a QCN
 * ```
 *
 * `null` rather than {@link MATCHES_NOTHING} is load-bearing: `?q=` is what a
 * cleared input sends, and it has to reach the caller as "no filter". Read as
 * an impossible filter, clearing the search box would empty the table.
 *
 * Resolvers run in parallel — a four-token query with two token branches and
 * one term branch costs nine small indexed lookups in one round of
 * `Promise.all`, not nine round trips. Each resolver caps its own `$in`.
 */
export async function buildSearchFilter<T>(
  raw: unknown,
  options: SearchFilterOptions<T>,
): Promise<FilterQuery<T> | null> {
  const tokens = searchTokens(raw);
  if (!tokens.length) return null;

  const { fields, tokenBranches = [], termBranches = [] } = options;
  const term = typeof raw === 'string' ? raw.trim() : '';

  const [perToken, perTerm] = await Promise.all([
    Promise.all(
      tokens.map((token) =>
        Promise.all(tokenBranches.map((resolve) => resolve(token))),
      ),
    ),
    Promise.all(termBranches.map((resolve) => resolve(term))),
  ]);

  const clauses = tokens.map((token, index) => {
    const or: FilterQuery<T>[] = fields.map(
      (field) => ({ [field]: tokenRegex(token) }) as FilterQuery<T>,
    );
    for (const branch of perToken[index]) {
      if (branch) or.push(branch);
    }
    return { $or: or };
  });

  // A plain loop, not `.filter()` with a type predicate: `Promise.all` widens
  // the element type through `Awaited<>`, and TS will not accept a predicate
  // narrowing to `FilterQuery<T>` from that because a generic `T` could itself
  // be a thenable.
  const alternatives: FilterQuery<T>[] = [];
  for (const branch of perTerm) {
    if (branch) alternatives.push(branch);
  }

  // Every token resolved to an empty `$or`: possible only when `fields` is
  // empty and no token branch matched. A supplied query with nowhere left to
  // match is a genuine empty result, not "no filter" — unless a whole-term
  // branch still answers it.
  const tokensMatchNothing = clauses.every((clause) => clause.$or.length === 0);
  if (tokensMatchNothing) {
    if (!alternatives.length) return MATCHES_NOTHING;
    return alternatives.length === 1 ? alternatives[0] : { $or: alternatives };
  }

  const tokenClause = { $and: clauses } as FilterQuery<T>;
  if (!alternatives.length) return tokenClause;
  return { $or: [tokenClause, ...alternatives] };
}
