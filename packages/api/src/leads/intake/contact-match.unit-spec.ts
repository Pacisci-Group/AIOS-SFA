import { Types } from 'mongoose';
import {
  ContactCandidate,
  MatchSignals,
  pickBestContact,
  scoreCandidate,
} from './contact-match';
import { parseDateOfBirth } from './intake.normalize';

/** Ascending ids, so "lowest _id wins" is testable. */
const idA = new Types.ObjectId('000000000000000000000001');
const idB = new Types.ObjectId('000000000000000000000002');

function candidate(
  overrides: Partial<ContactCandidate> = {},
): ContactCandidate {
  return { _id: idA, emails: [], phones: [], dateOfBirth: null, ...overrides };
}

function signals(overrides: Partial<MatchSignals> = {}): MatchSignals {
  return { dateOfBirth: null, email: null, phone: null, ...overrides };
}

describe('contact matching', () => {
  describe('scoreCandidate', () => {
    it('scores a matching date of birth highest', () => {
      const score = scoreCandidate(
        candidate({ dateOfBirth: new Date('1990-02-05T00:00:00.000Z') }),
        signals({ dateOfBirth: parseDateOfBirth('1990-02-05') }),
      );
      expect(score).toBe(4);
    });

    it('matches a DOB regardless of any time component stored on it', () => {
      const score = scoreCandidate(
        // Migrated records carry a timestamp, not a clean midnight.
        candidate({ dateOfBirth: new Date('1990-02-05T17:42:11.000Z') }),
        signals({ dateOfBirth: parseDateOfBirth('1990-02-05') }),
      );
      expect(score).toBe(4);
    });

    // The headline fix: a DOB conflict means two different people, and no
    // amount of other agreement should override it. Legacy treated a conflict
    // and an absence identically, which is what produced duplicate contacts.
    it('disqualifies a DOB conflict even when the email matches', () => {
      const score = scoreCandidate(
        candidate({
          dateOfBirth: new Date('1975-01-01T00:00:00.000Z'),
          emails: ['same@example.com'],
        }),
        signals({
          dateOfBirth: parseDateOfBirth('1990-02-05'),
          email: 'same@example.com',
        }),
      );
      expect(score).toBe(Number.NEGATIVE_INFINITY);
    });

    it('falls through to email when DOB is absent on either side', () => {
      expect(
        scoreCandidate(
          candidate({ emails: ['pat@example.com'] }),
          signals({
            dateOfBirth: parseDateOfBirth('1990-02-05'),
            email: 'pat@example.com',
          }),
        ),
      ).toBe(2);

      expect(
        scoreCandidate(
          candidate({
            dateOfBirth: new Date('1990-02-05T00:00:00.000Z'),
            emails: ['pat@example.com'],
          }),
          signals({ email: 'pat@example.com' }),
        ),
      ).toBe(2);
    });

    // Legacy required `typeof stored === 'string'` while the store held arrays,
    // so this branch was dead code and never matched anything in production.
    it('compares against ARRAY-valued stored emails and phones', () => {
      const score = scoreCandidate(
        candidate({
          emails: ['old@example.com', 'PAT@Example.com'],
          phones: ['(555) 123-4567', '5559999999'],
        }),
        signals({ email: 'pat@example.com', phone: '5551234567' }),
      );
      expect(score).toBe(4);
    });

    it('matches a phone across a country-code difference', () => {
      const score = scoreCandidate(
        candidate({ phones: ['+1 (555) 123-4567'] }),
        signals({ phone: '5551234567' }),
      );
      expect(score).toBe(2);
    });

    it('scores a bare name collision at zero', () => {
      expect(scoreCandidate(candidate(), signals())).toBe(0);
      expect(
        scoreCandidate(
          candidate({ emails: ['someone@example.com'] }),
          signals({ email: 'different@example.com' }),
        ),
      ).toBe(0);
    });
  });

  describe('pickBestContact', () => {
    it('returns null when nothing scores — a name alone is not a match', () => {
      expect(
        pickBestContact([candidate(), candidate({ _id: idB })], signals()),
      ).toBeNull();
    });

    it('returns null for an empty candidate list', () => {
      expect(pickBestContact([], signals({ email: 'a@b.com' }))).toBeNull();
    });

    it('prefers the highest-scoring candidate', () => {
      const dob = new Date('1990-02-05T00:00:00.000Z');
      const emailOnly = candidate({ _id: idA, emails: ['pat@example.com'] });
      const dobAndEmail = candidate({
        _id: idB,
        dateOfBirth: dob,
        emails: ['pat@example.com'],
      });

      const best = pickBestContact([emailOnly, dobAndEmail], {
        dateOfBirth: parseDateOfBirth('1990-02-05'),
        email: 'pat@example.com',
        phone: null,
      });
      expect(best?._id).toBe(idB);
    });

    it('breaks ties on the lowest id so repeat submissions converge', () => {
      const shared = { emails: ['pat@example.com'] };
      const first = candidate({ _id: idA, ...shared });
      const second = candidate({ _id: idB, ...shared });
      const sig = signals({ email: 'pat@example.com' });

      expect(pickBestContact([first, second], sig)?._id).toBe(idA);
      // Candidate order must not change the outcome.
      expect(pickBestContact([second, first], sig)?._id).toBe(idA);
    });

    it('never returns a disqualified candidate', () => {
      const conflicting = candidate({
        _id: idA,
        dateOfBirth: new Date('1975-01-01T00:00:00.000Z'),
        emails: ['pat@example.com'],
        phones: ['5551234567'],
      });

      expect(
        pickBestContact([conflicting], {
          dateOfBirth: parseDateOfBirth('1990-02-05'),
          email: 'pat@example.com',
          phone: '5551234567',
        }),
      ).toBeNull();
    });
  });
});
