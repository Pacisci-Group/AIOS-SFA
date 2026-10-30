/**
 * A person's Allstate identifiers (PAC-173), stored on the **user**.
 *
 * - **Bind ID** — the Allstate portal login that binds a policy. Dash prints it
 *   on every line, so it is what tells the agency's own business from
 *   business Allstate sold directly (a Bind ID on no staff user that Dash
 *   prints no name for is 1-800; a named one is a former employee's).
 * - **Sub-producer code** — the three-digit code Allstate credits a sale to.
 *   `000` is Allstate's "no sub-producer"; it appears beside several people's
 *   Bind IDs, so it is never a person's code.
 *
 * Both are entered when the person is onboarded (by the inviter or by the
 * employee) and corrected later from the profile page or the Users page. One
 * set of rules normalises them everywhere — every write path and the
 * reconciliation engine's lookup keys — so a code typed `sok5pe0t` matches a
 * Dash line printing `SOK5PE0T`, and `34` matches `034`.
 */

export const ALLSTATE_CODE_FIELDS = [
  'allstateBindId',
  'allstateSubProducerCode',
] as const;
export type AllstateCodeField = (typeof ALLSTATE_CODE_FIELDS)[number];

export const ALLSTATE_CODE_LABELS: Record<AllstateCodeField, string> = {
  allstateBindId: 'Allstate Bind ID',
  allstateSubProducerCode: 'Allstate sub-producer code',
};

/** 409 when another user of the agency already holds the code. */
export const ALLSTATE_CODE_DUPLICATE = 'ALLSTATE_CODE_DUPLICATE';

export const ALLSTATE_BIND_ID_MAX_LENGTH = 32;

/** Letters, digits and `.`/`_`/`-`, after upper-casing — e.g. `SOK5PE0T`, `SJM-RCM`. */
const BIND_ID_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

function text(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/** A Bind ID as a lookup key: trimmed, upper-cased; `null` when blank. Dash mixes the case. */
export function normalizeBindId(raw: unknown): string | null {
  const value = text(raw);
  return value ? value.toUpperCase() : null;
}

/**
 * A sub-producer code as a lookup key, or `null`.
 *
 * Excel turns `034` into `34`, so a number is padded back. `000` reads as
 * blank — it is the carrier's "no sub-producer" — so credit falls back to the
 * Bind ID.
 */
export function normalizeSubProducerCode(raw: unknown): string | null {
  const value =
    typeof raw === 'number' && Number.isFinite(raw)
      ? String(Math.trunc(raw))
      : text(raw);
  if (!value) return null;
  const code = /^\d{1,3}$/.test(value)
    ? value.padStart(3, '0')
    : value.toUpperCase();
  return code === '000' ? null : code;
}

/** Why a typed Bind ID cannot be stored, or `null` when it can (blank included). */
export function bindIdError(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  if (!value) return null;
  if (value.length > ALLSTATE_BIND_ID_MAX_LENGTH) {
    return `A Bind ID is at most ${ALLSTATE_BIND_ID_MAX_LENGTH} characters.`;
  }
  return BIND_ID_PATTERN.test(value)
    ? null
    : 'A Bind ID is letters and digits, as Dash prints it — for example SOK5PE0T.';
}

/** Why a typed sub-producer code cannot be stored, or `null` when it can (blank included). */
export function subProducerCodeError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d{1,3}$/.test(value)) {
    return 'A sub-producer code is up to three digits — for example 034.';
  }
  return /^0+$/.test(value)
    ? '000 is Allstate’s “no sub-producer” — leave the code blank instead.'
    : null;
}
