/**
 * The shape every "SmartSuite choice code → human label" mapping takes (PAC-80).
 *
 * `normalizePolicyType`, `normalizeLeadStatus` and `normalizeCarrier` were each
 * hand-written before this existed, and PAC-80 needed ten more of them. Ten more
 * copies of the same twelve lines is ten more chances to forget the passthrough
 * branch or the case-insensitive compare, so the *behaviour* lives here once and
 * each field module declares only what is genuinely its own: the canonical
 * labels, and which opaque codes map onto them.
 *
 * The three originals are deliberately **not** refactored onto this. They carry
 * field-specific rules this cannot express — `normalizePolicyType` has a second
 * label-alias table, `normalizeLeadSource` returns a `{ code, label }` pair and
 * keeps the code. Rewriting them to fit would be shaping working code around a
 * helper rather than the reverse.
 *
 * ## Why codes are never shared between fields
 *
 * SmartSuite choice codes are unique only *within a field*. Field id
 * `sb3cc60eb5` carries codes `XT6s7`/`fr4Ge` in two different tables, meaning
 * Auto/Home in Prior Policies and "SFA Call"/"Customer Call" in Prior Insurance
 * (`docs/smartsuite-tables/The Prior Insurance Table.md:20`). A single global
 * lookup would therefore silently mistranslate one of them. That is why this is
 * a factory producing one closed vocabulary per field, and never a shared map.
 */

export interface ChoiceVocabulary {
  /**
   * Stored value → canonical label.
   *
   * Accepts a raw choice code, or any spelling of the label, case-insensitively.
   * An already-canonical label passes through unchanged, which is what makes it
   * safe to apply on both write and read and to re-run over healed data.
   *
   * An unrecognized non-empty value **passes through trimmed** rather than
   * becoming `''` or `undefined`. Two reasons: a code we have not catalogued
   * still renders as itself instead of vanishing, and — because Mongoose strips
   * `undefined` out of a `$set` — returning nothing would make a re-import a
   * silent no-op that leaves the old wrong value in place.
   */
  normalize: (raw?: string | null) => string;
  /**
   * Canonical label → every stored form that must match it, for a Mongo
   * `{ field: { $in: [...] } }` filter. Lets a query for "Active" also match
   * documents still holding `b5qvJ`.
   */
  queryValues: (label: string) => string[];
  /** True when `raw` resolves to one of the catalogued labels. */
  isCanonical: (raw?: string | null) => boolean;
}

/**
 * Build a vocabulary from its canonical labels and its code aliases.
 *
 * `codeAliases` maps SmartSuite's opaque codes (`b5qvJ`) onto labels. Codes that
 * are *already* the label — SmartSuite often uses the label as its own code, as
 * with the Leads table's `Hot`/`Warm`/`Cold` — need no entry: they resolve
 * through the case-insensitive label lookup.
 */
export function choiceVocabulary(
  labels: readonly string[],
  codeAliases: Readonly<Record<string, string>> = {},
): ChoiceVocabulary {
  const canonicalByLower = new Map(
    labels.map((label) => [label.toLowerCase(), label]),
  );

  const normalize = (raw?: string | null): string => {
    const value = (raw ?? '').trim();
    if (!value) return '';
    // Code lookup first, and case-sensitively: codes are opaque and
    // case-significant (`a2E7K`), whereas labels are not.
    const byCode = codeAliases[value];
    if (byCode) return byCode;
    return canonicalByLower.get(value.toLowerCase()) ?? value;
  };

  return {
    normalize,
    queryValues: (label: string): string[] => {
      const canonical = normalize(label);
      if (!canonical) return [];
      const codes = Object.entries(codeAliases)
        .filter(([, mapped]) => mapped === canonical)
        .map(([code]) => code);
      return [canonical, ...codes];
    },
    isCanonical: (raw?: string | null): boolean => {
      const value = normalize(raw);
      return value !== '' && canonicalByLower.has(value.toLowerCase());
    },
  };
}
