/**
 * Quote Control Number normalization (PAC-73, moved to `shared` by PAC-61).
 *
 * A mail piece prints one of two forms of the same identifier, and they are
 * **different strings**, not alternates of one another:
 *
 * - `controlno` — `#` followed by a UUID, e.g. `#3f2a…-…-…-…-…9c41b2d70e58`
 * - `New Control Number` — the last 12 hex characters of that UUID, `9c41b2d70e58`
 *
 * They differ on 671,339/671,339 legacy rows and on 20,405/20,405 rows of the
 * reference RTP file. Legacy had no way to relate them and resorted to
 * `ENDS_WITH` / `CONTAINS_SUBSTR` matching, which is both a collection scan and
 * a correctness hazard. Storing both normalized forms in one multikey-indexed
 * array turns "match either form" into a single indexed equality.
 *
 * It lives in `shared` because there are now **four** consumers and they must
 * agree exactly: the RTP/BigQuery importer, the demo seed, the QCN lookup
 * endpoint, and the Mailers drawer — which normalizes client-side both to gate
 * its debounced request on a minimum length and to key its query cache. A
 * hand-copied regex that drifts on one side does not fail loudly; it produces a
 * 404 on a control number that is perfectly valid. Same reasoning, and the same
 * move, as `policyNumberKey` (`domain/policy-number.ts`, PAC-56 #20).
 */

/**
 * The stored, comparable form of one control number.
 *
 * Uppercased with non-alphanumerics stripped, so a producer typing
 * `#3f2a-9c41` , ` 9c41b2d70e58 ` or `9C41B2D70E58` all reach the same key.
 * Same approach as `policyNumberKey`: normalize on **write** so the lookup
 * stays index-backed — normalizing inside the query would force a scan on every
 * keystroke of a debounced search.
 */
export function mailerControlNumberKey(raw: unknown): string | undefined {
  if (typeof raw === 'number') return String(raw);
  if (typeof raw !== 'string') return undefined;
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key === '' ? undefined : key;
}

/**
 * Every form of a mailer's control number, normalized and deduplicated.
 *
 * Deduplication matters: the unique index spans the array, so repeating a value
 * inside one document is a self-collision. Order is stable — the long form
 * first — so the first element can be used as the upsert filter, and as the
 * per-mailer idempotency key when logging a lead (PAC-61).
 */
export function mailerControlNumberKeys(
  controlNumber: unknown,
  newControlNumber: unknown,
): string[] {
  const keys = [
    mailerControlNumberKey(controlNumber),
    mailerControlNumberKey(newControlNumber),
  ].filter((key): key is string => key !== undefined);

  return [...new Set(keys)];
}

/**
 * Shortest normalized input the drawer will send to the lookup.
 *
 * Matching is exact equality against a stored key, not a prefix scan, so below
 * this length a request can only ever 404 — firing one is pure noise while the
 * producer is still typing the first few characters. This is a request gate,
 * not validation: a longer key that matches nothing is a perfectly ordinary
 * "no record" answer. Precedent: `MIN_POLICY_NUMBER_KEY_LENGTH`.
 */
export const MIN_MAILER_CONTROL_NUMBER_KEY_LENGTH = 6;
