/**
 * Free-text search normalization (PAC-101).
 *
 * Every paginated table in the app used to search a **narrower field set than
 * it rendered**, and each one had invented its own rules for doing so — the
 * mailer records table anchored a prefix regex on two of six shown columns, the
 * Leads box short-circuited on `@` so an email query could never fall back to a
 * name, and the agency roster lower-cased in the browser over three of its five
 * columns. A user copied a value out of a cell, pasted it into the search box
 * directly above that cell, and got "No records match".
 *
 * The fix is one rule, applied everywhere:
 *
 * > **Tokenize on whitespace, AND the tokens, OR each token across every
 * > searched field.**
 *
 * That shape is what makes the awkward cases fall out instead of needing their
 * own branches:
 *
 * - `John Smith` matches `firstName: 'John'` + `lastName: 'Smith'` **in either
 *   order**, with no `$expr`/`$concat` stage. Two services carried a hand-rolled
 *   `$regexMatch` over a concatenation purely for this; both are deleted.
 * - `SMITH` matches a record whose `lastName` is `'ANN SMITH'`, because a token
 *   is a *contains* and not a prefix. (The mailer importer splits a combined
 *   name on the first space, so `MARY ANN SMITH` really is stored that way.)
 * - `smith tulsa` finds a Smith in Tulsa — the tokens match *different fields*.
 * - `147` finds `HH-2147`.
 *
 * It lives in `shared` for the same reason `policyNumberKey` and
 * `mailerControlNumberKey` moved here: **more than one consumer, and they must
 * agree exactly.** The API builds Mongo filters from these tokens; the web uses
 * the same tokens to gate a debounced request and to key its query cache. A
 * hand-copied regex that drifts on one side does not fail loudly — it returns
 * "no records" for input that is perfectly valid.
 *
 * ⚠ **Not fuzzy matching.** No edit distance, no stemming, no relevance
 * ranking — that is PAC-42 (⌘K omni-search) and it will be designed there.
 * This is exact substring matching with case, accent and punctuation folded
 * away.
 */

/**
 * Longest query any caller will look at, already the DTO cap on all four
 * endpoints. Restated here so the shared tokenizer bounds its own work rather
 * than trusting whichever caller reached it.
 */
export const MAX_SEARCH_TERM_LENGTH = 120;

/**
 * How many tokens one query may fan out into.
 *
 * Each token becomes its own `$or` across every searched field, so cost grows
 * as `tokens × fields` — and on the tables that resolve child collections, each
 * token also costs a lookup. Four covers every realistic query ("john smith
 * tulsa ok"); beyond that a user has pasted something that was never a search
 * term, and the extra clauses only narrow a result set that is already empty.
 *
 * Extra tokens are **dropped, not rejected**. A too-long query returning the
 * matches for its first four words is a better answer than a 400.
 */
export const MAX_SEARCH_TOKENS = 4;

/**
 * Case, accent and punctuation folded away; whitespace collapsed.
 *
 * Decomposes to NFD and strips the combining marks, so `Muñoz` and `Munoz` are
 * the same query — migrated SmartSuite data holds both spellings of several
 * surnames, and a producer typing the ASCII one is the common case.
 *
 * Punctuation becomes a **space rather than nothing**, which is what makes
 * `Smith-Jones` tokenize into two searchable words. Folding it away entirely
 * would instead produce `smithjones`, matching neither half.
 */
export function normalizeSearchText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .slice(0, MAX_SEARCH_TERM_LENGTH)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The words to AND together, normalized, deduplicated and capped.
 *
 * Empty for input with nothing searchable in it — callers must treat that as
 * **no filter at all**, never as a filter nothing satisfies. `?q=` is what a
 * cleared input sends, and reading it as an impossible filter is how a search
 * box ends up returning zero rows the moment you empty it.
 */
export function searchTokens(raw: unknown): string[] {
  const normalized = normalizeSearchText(raw);
  if (!normalized) return [];
  return [...new Set(normalized.split(' '))].slice(0, MAX_SEARCH_TOKENS);
}

/**
 * Digits only — `(918) 555-0134`, `918-555-0134` and `9185550134` collapse to
 * the same string.
 *
 * Phone numbers are stored in whatever format the source system used, so
 * matching has to fold formatting on **both** sides: this normalizes the query,
 * and the API's `phoneDigitsRegex` re-interleaves the digits with `\D*` so they
 * match a stored value that was never normalized.
 */
export function searchDigits(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
}

/**
 * Below this many digits, a "phone match" is noise: a 4-digit run appears
 * inside policy numbers, ZIPs and street numbers alike. Seven is a local number
 * without its area code, which is the shortest thing anyone actually searches.
 */
export const MIN_PHONE_SEARCH_DIGITS = 7;

/**
 * Whether a term is worth searching as a phone number.
 *
 * This is a **hint, not a route.** Its whole point is that a term can be
 * phone-shaped *and* still be searched as everything else — the Leads box used
 * to `return` on this test, which is why a lead whose quote control number was
 * all digits became unreachable by name.
 */
export function isPhoneLike(raw: unknown): boolean {
  return searchDigits(raw).length >= MIN_PHONE_SEARCH_DIGITS;
}
