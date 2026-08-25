import { Types } from 'mongoose';
import {
  normalizeEmail,
  normalizePhone,
  phonesMatch,
  toDateKey,
} from './intake.normalize';

/**
 * Person-first contact matching (PAC-37) — pure, so it unit-tests without Mongo.
 *
 * Candidates arrive already narrowed to an exact (case-insensitive) first+last
 * name match; this decides whether any of them is actually the same person.
 *
 * The governing principle, and the reason every ambiguous case resolves toward
 * "no match": **creating a duplicate contact is recoverable; merging two
 * different people is not.** A duplicate is a cleanup task. A merge silently
 * writes one client's lead into another client's household, and nothing in the
 * UI would ever show that it happened.
 */

/** The stored fields matching reads. Structural, so a lean doc satisfies it. */
export interface ContactCandidate {
  _id: Types.ObjectId;
  emails?: string[] | null;
  phones?: string[] | null;
  dateOfBirth?: Date | string | null;
}

/** The submitted person, already normalised. */
export interface MatchSignals {
  dateOfBirth: Date | null;
  email: string | null;
  phone: string | null;
}

/** Disqualifies a candidate outright — a DOB conflict means a different person. */
const DISQUALIFIED = Number.NEGATIVE_INFINITY;

const SCORE_DOB = 4;
const SCORE_EMAIL = 2;
const SCORE_PHONE = 2;

/**
 * Score one candidate against the submitted signals.
 *
 * - Matching DOB is the strongest signal (+4) — it's the field legacy called
 *   primary, and two people sharing a name *and* a birth date is rare.
 * - **Conflicting** DOB disqualifies. This is the fix for legacy's worst
 *   matching bug: it conflated a DOB *conflict* with a DOB *absence*, so a
 *   single name-hit whose DOB disagreed fell through to "no match" and created a
 *   duplicate — while a name-hit with no stored DOB never reached the
 *   email/phone tiebreak at all, because that only ran when more than one
 *   candidate came back.
 * - Email and phone each add +2 and are checked at every candidate count.
 */
export function scoreCandidate(
  candidate: ContactCandidate,
  signals: MatchSignals,
): number {
  const candidateDob = toDateKey(candidate.dateOfBirth);
  const submittedDob = toDateKey(signals.dateOfBirth);

  if (candidateDob && submittedDob) {
    if (candidateDob !== submittedDob) return DISQUALIFIED;
  }

  let score = candidateDob && submittedDob ? SCORE_DOB : 0;

  // Both sides are normalised here. Legacy compared a normalised submission
  // against the raw stored value and required `typeof === 'string'` where the
  // store held arrays — so this tiebreak never once fired in production.
  if (signals.email) {
    const emails = (candidate.emails ?? []).map(normalizeEmail);
    if (emails.includes(signals.email)) score += SCORE_EMAIL;
  }

  if (signals.phone) {
    const phones = (candidate.phones ?? []).map(normalizePhone);
    if (phones.some((phone) => phonesMatch(phone, signals.phone))) {
      score += SCORE_PHONE;
    }
  }

  return score;
}

/**
 * Pick the best match, or null to create a new contact.
 *
 * Requires a positive score: a bare name collision with nothing else in common
 * is not a match. Ties break on the lowest `_id` so repeated submissions of the
 * same form always converge on the same contact rather than oscillating.
 */
export function pickBestContact<T extends ContactCandidate>(
  candidates: readonly T[],
  signals: MatchSignals,
): T | null {
  let best: T | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, signals);
    if (score <= 0) continue;

    if (
      score > bestScore ||
      (score === bestScore &&
        best !== null &&
        candidate._id.toString() < best._id.toString())
    ) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
