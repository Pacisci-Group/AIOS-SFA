/**
 * Dash's customer name as a lead's first and last name, for the New Lead form
 * an assignee opens from a Dash row (PAC-173 PR 4).
 *
 * Dash prints `FIRST LAST`, upper-cased (`JACQUELINE BANUELOS MURILLO`). The
 * first token is the first name and **everything after it** the last name:
 * a two-part surname is far commoner on these files than a middle name, and
 * the producer confirms the split on the form anyway. Each part is
 * title-cased across spaces, hyphens and apostrophes (`O'NEIL` → `O'Neil`,
 * `SMITH-JONES` → `Smith-Jones`); a `MC`/`MAC` prefix is left as `Mc…` — there
 * is no rule that gets every one right, and the form is where it is fixed.
 *
 * A single token is a first name with an empty last name, which the form
 * then asks for. Blank is `null`: there is nothing to prefill.
 */
export function splitDashCustomerName(
  raw: string | null | undefined,
): { firstName: string; lastName: string } | null {
  const tokens = (raw ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const [first, ...rest] = tokens;
  return { firstName: titleCase(first), lastName: titleCase(rest.join(' ')) };
}

/** Upper-case each letter that starts a word, a hyphenated part or follows an apostrophe. */
function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(
      /(^|[\s\-'’])(\p{L})/gu,
      (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
    );
}
