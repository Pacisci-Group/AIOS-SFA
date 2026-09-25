/**
 * What the app shows where a value does not exist.
 *
 * **One placeholder, everywhere: `N/A`.** The app used to say this three ways —
 * an em dash in most tables, an `X` on the Owner leaderboard's goal column, and
 * a bare blank here and there — and a reader cannot tell whether three glyphs
 * mean three different things. They never did. An em dash in particular reads as
 * punctuation, or as a rendering glitch, to someone who is not a developer.
 *
 * Use it for a value that is **missing or does not apply**: no email on file, an
 * average over zero households, a rank for a row that is not ranked.
 *
 * Do **not** use it for:
 * - a **zero** — `$0` and `0 items` are information, not an absence;
 * - a **loading** state — that is a skeleton, not a claim that nothing exists;
 * - an **empty list** — that is a sentence ("No leads in this period").
 *
 * Always this constant, never the literal, so the next change to the wording is
 * one line rather than a sweep across forty-five files — which is what
 * introducing it took.
 */
export const NOT_AVAILABLE = "N/A";
