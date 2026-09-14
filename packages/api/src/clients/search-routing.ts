import {
  formatHouseholdRef,
  normalizePolicyNumber,
  parseHouseholdRef,
} from '@sfa/shared';
import { parseDateOfBirth } from '../leads/intake/intake.normalize';

/**
 * The things a Clients search term can be that **must not be tokenized**.
 *
 * Each of these is one indivisible value: splitting `HH-2614` into `hh` + `2614`
 * or `03/12/1985` into three numbers loses the thing the user typed. They are
 * resolved from the whole term and ORed *around* the token clause — see
 * `TermBranchResolver` in `common/mongo/search-filter.ts`.
 *
 * Every hit is queried and ORed — none excludes another — so a term that is
 * ambiguous between two dimensions is simply searched as both.
 *
 * ⚠ There is deliberately **no `name` route any more** (PAC-101). It used to be
 * suppressed whenever the term parsed as a reference or a date, which is the
 * bug: a household literally named "Ann Smith 1985" was unreachable, and more
 * to the point the suppression is what stopped `HH-2614` also matching a
 * household whose *name* contains 2614. Names are the tokenizer's job now, and
 * the tokenizer never suppresses anything.
 */
export interface SearchRoutes {
  /** Canonical `HH-2614`, ready to match the stored (uppercased) value. */
  householdRef?: string;
  /** UTC midnight, for a `$gte`/`$lt` day range on `contacts.dateOfBirth`. */
  dateOfBirth?: Date;
  /** Normalized policy-number key, for `policies.policyNumberKey`. */
  policyKey?: string;
}

/**
 * Interpret an omni-search term by shape.
 *
 * Routing is **additive, not exclusive**: `HH-2614` normalizes to a usable
 * policy key as well as a reference, so both are queried and whichever matches
 * wins. Being strict there would mean a household number that happens to look
 * like a policy number silently finds nothing.
 */
export function routeSearchTerm(raw: string): SearchRoutes {
  const term = raw.trim();
  const routes: SearchRoutes = {};
  if (!term) return routes;

  const seq = parseHouseholdRef(term);
  if (seq !== null) routes.householdRef = formatHouseholdRef(seq);

  const date = parseSearchDate(term);
  if (date) routes.dateOfBirth = date;

  // `normalizePolicyNumber`, not `policyNumberKey`: below its length floor a
  // "match" carries no information, and every two-letter name would otherwise
  // drag the whole policy collection into the query.
  const key = normalizePolicyNumber(term);
  if (key) routes.policyKey = key;

  return routes;
}

/**
 * A date typed into the search box, as UTC midnight.
 *
 * Accepts `YYYY-MM-DD` and the `MM/DD/YYYY` an American agency actually types,
 * then hands both to `parseDateOfBirth` — which builds the date from explicit
 * components, so a birthday never shifts a day west of Greenwich. That matters
 * here more than anywhere: the stored value *is* UTC midnight, so a date built
 * through the local timezone misses by a full day for half the book.
 */
export function parseSearchDate(term: string): Date | null {
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(term.trim());
  if (slashed) {
    const [, month, day, year] = slashed;
    return parseDateOfBirth(
      `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
    );
  }
  return parseDateOfBirth(term.trim());
}
