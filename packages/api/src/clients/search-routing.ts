import {
  formatHouseholdRef,
  normalizePolicyNumber,
  parseHouseholdRef,
} from '@sfa/shared';
import { parseDateOfBirth } from '../leads/intake/intake.normalize';

/**
 * What a free-text Clients search could plausibly be.
 *
 * Every hit is queried and ORed — none excludes another — so a term that is
 * ambiguous between two dimensions is simply searched as both.
 */
export interface SearchRoutes {
  /** Canonical `HH-2614`, ready to match the stored (uppercased) value. */
  householdRef?: string;
  /** UTC midnight, for a `$gte`/`$lt` day range on `contacts.dateOfBirth`. */
  dateOfBirth?: Date;
  /** Normalized policy-number key, for `policies.policyNumberKey`. */
  policyKey?: string;
  /** The term as a name, for households and contacts. */
  name?: string;
}

/**
 * Interpret an omni-search term by shape, the way `GET /leads` reads its own
 * `search` param.
 *
 * Routing is **additive, not exclusive**: `HH-2614` normalizes to a usable
 * policy key as well as a reference, so both are queried and whichever matches
 * wins. Being strict there would mean a household number that happens to look
 * like a policy number silently finds nothing.
 *
 * The one thing shape genuinely decides is `name`. A term that parses as a
 * reference or a date is not somebody's name, and searching it as one only adds
 * noise — `1985-03-12` would otherwise regex-scan every household name.
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

  if (!routes.householdRef && !routes.dateOfBirth) routes.name = term;

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
