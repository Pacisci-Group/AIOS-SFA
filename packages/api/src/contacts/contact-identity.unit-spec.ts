import { Types } from 'mongoose';
import {
  buildIdentityFilter,
  type DuplicateContact,
} from './contact-identity.service';
import {
  contactDobKey,
  contactIdentity,
  contactNameKey,
  hasCompleteIdentity,
  PartialNameUpdateError,
  stampIdentityKeys,
  stampIdentityKeysOnUpdate,
} from './contact-identity';

describe('contact identity keys (PAC-91 §9)', () => {
  describe('contactNameKey', () => {
    it('lowercases and collapses whitespace', () => {
      expect(contactNameKey('  Pat   Q ', 'MCDONALD')).toBe('pat q mcdonald');
    });

    // Half a name identifies nobody: a key built from one would collide every
    // "Smith" in the book, and the index leg would then refuse real data.
    it('is null unless both halves are present', () => {
      expect(contactNameKey('Pat', '')).toBeNull();
      expect(contactNameKey('', 'McDonald')).toBeNull();
      expect(contactNameKey(null, null)).toBeNull();
      expect(contactNameKey('Pat', '   ')).toBeNull();
    });
  });

  describe('contactDobKey', () => {
    it('is the UTC calendar date, never the local one', () => {
      expect(contactDobKey(new Date('1990-02-05T00:00:00.000Z'))).toBe(
        '1990-02-05',
      );
    });

    it('is null when there is no usable date', () => {
      expect(contactDobKey(null)).toBeNull();
      expect(contactDobKey(undefined)).toBeNull();
      expect(contactDobKey('not a date')).toBeNull();
    });
  });

  describe('contactIdentity', () => {
    it('normalises every leg the way it is stored', () => {
      expect(
        contactIdentity({
          firstName: ' Pat ',
          lastName: 'McDonald',
          dateOfBirth: new Date('1990-02-05T00:00:00.000Z'),
          email: 'PAT@Example.com',
          phone: '(555) 123-4567',
        }),
      ).toEqual({
        nameKey: 'pat mcdonald',
        dobKey: '1990-02-05',
        email: 'pat@example.com',
        phone: '5551234567',
      });
    });
  });

  /*
   * The honest position the whole design turns on: a row missing any leg is not
   * indexed and is not called a duplicate. 322 contacts on the production dump
   * have no DOB and 611 have neither phone nor email — claiming those are the
   * same person as a namesake would merge strangers.
   */
  describe('hasCompleteIdentity', () => {
    const full = {
      nameKey: 'pat mcdonald',
      dobKey: '1990-02-05',
      email: 'pat@example.com',
      phone: '5551234567',
    };

    it('accepts either contact-detail leg on its own', () => {
      expect(hasCompleteIdentity({ ...full, phone: null })).toBe(true);
      expect(hasCompleteIdentity({ ...full, email: null })).toBe(true);
    });

    it('rejects a missing name, DOB, or both details', () => {
      expect(hasCompleteIdentity({ ...full, nameKey: null })).toBe(false);
      expect(hasCompleteIdentity({ ...full, dobKey: null })).toBe(false);
      expect(hasCompleteIdentity({ ...full, email: null, phone: null })).toBe(
        false,
      );
    });
  });

  describe('buildIdentityFilter', () => {
    const agencyId = '6a95edcfb1c4e8eb86f954b9';

    it('ANDs name and DOB, ORs the two contact details', () => {
      expect(
        buildIdentityFilter(agencyId, {
          nameKey: 'pat mcdonald',
          dobKey: '1990-02-05',
          email: 'pat@example.com',
          phone: '5551234567',
        }),
      ).toEqual({
        agencyId,
        nameKey: 'pat mcdonald',
        dobKey: '1990-02-05',
        isTestRecord: { $ne: true },
        $or: [{ phone: '5551234567' }, { email: 'pat@example.com' }],
      });
    });

    // Offering a `{ phone: null }` leg would match every phone-less namesake,
    // which is the merge-two-strangers failure this rule exists to avoid.
    it('offers only the legs the person actually has', () => {
      const filter = buildIdentityFilter(agencyId, {
        nameKey: 'pat mcdonald',
        dobKey: '1990-02-05',
        email: 'pat@example.com',
        phone: null,
      });
      expect(filter.$or).toEqual([{ email: 'pat@example.com' }]);
    });

    it('excludes a given id, for the edit path', () => {
      const id = new Types.ObjectId();
      const filter = buildIdentityFilter(
        agencyId,
        {
          nameKey: 'pat mcdonald',
          dobKey: '1990-02-05',
          email: 'pat@example.com',
          phone: null,
        },
        id,
      );
      expect(filter._id).toEqual({ $ne: id });
    });
  });

  describe('stampIdentityKeys', () => {
    it('fills both keys on a document-shaped write', () => {
      const doc: Record<string, unknown> = {
        firstName: 'Pat',
        lastName: 'McDonald',
        dateOfBirth: new Date('1990-02-05T00:00:00.000Z'),
      };
      stampIdentityKeys(doc);
      expect(doc.nameKey).toBe('pat mcdonald');
      expect(doc.dobKey).toBe('1990-02-05');
    });

    it('leaves a key undefined when its source is incomplete', () => {
      const doc: Record<string, unknown> = { firstName: 'Pat' };
      stampIdentityKeys(doc);
      expect(doc.nameKey).toBeUndefined();
      expect(doc.dobKey).toBeUndefined();
    });

    it('derives from an update that sets the source fields', () => {
      const update: Record<string, unknown> = {
        $set: {
          firstName: 'Pat',
          lastName: 'McDonald',
          dateOfBirth: new Date('1990-02-05T00:00:00.000Z'),
        },
      };
      stampIdentityKeysOnUpdate(update);
      expect(update.$set).toMatchObject({
        nameKey: 'pat mcdonald',
        dobKey: '1990-02-05',
      });
    });

    // The intake merge's shape: it fills a blank date of birth and nothing else,
    // which has to bring the contact into the identity indexes.
    it('derives dobKey alone when only the date of birth is set', () => {
      const update: Record<string, unknown> = {
        $set: { dateOfBirth: new Date('1990-02-05T00:00:00.000Z') },
      };
      stampIdentityKeysOnUpdate(update);
      expect(update.$set).toEqual({
        dateOfBirth: new Date('1990-02-05T00:00:00.000Z'),
        dobKey: '1990-02-05',
      });
    });

    it('ignores an update that touches neither source', () => {
      const update: Record<string, unknown> = { $set: { notes: 'hello' } };
      stampIdentityKeysOnUpdate(update);
      expect(update.$set).toEqual({ notes: 'hello' });
    });

    // A cleared date of birth must *remove* the row from the indexes, not leave
    // it there under a birthday it no longer claims.
    it('unsets dobKey when the date of birth is cleared', () => {
      const update: Record<string, unknown> = { $unset: { dateOfBirth: '' } };
      stampIdentityKeysOnUpdate(update);
      expect(update.$unset).toEqual({ dateOfBirth: '', dobKey: '' });
    });

    it('treats bare top-level keys as $set, the way Mongoose does', () => {
      const update: Record<string, unknown> = {
        firstName: 'Pat',
        lastName: 'McDonald',
      };
      stampIdentityKeysOnUpdate(update);
      expect(update.$set).toEqual({ nameKey: 'pat mcdonald' });
    });

    /*
     * A stale `nameKey` is worse than a missing one — the row sits in the unique
     * index under the old identity, blocking nothing and matching nobody. No
     * call site does this today (renames go through `save()`); this is what
     * makes a future one fail at the write rather than corrupt the index.
     */
    it('refuses a half-rename it cannot resolve', () => {
      expect(() =>
        stampIdentityKeysOnUpdate({ $set: { firstName: 'Pat' } }),
      ).toThrow(PartialNameUpdateError);
      expect(() =>
        stampIdentityKeysOnUpdate({ $set: { lastName: 'McDonald' } }),
      ).toThrow(PartialNameUpdateError);
    });

    it('does nothing to a null or non-object target', () => {
      expect(() => stampIdentityKeys(null)).not.toThrow();
      expect(() => stampIdentityKeysOnUpdate(undefined)).not.toThrow();
      expect(() => stampIdentityKeysOnUpdate('nope')).not.toThrow();
    });
  });
});

/** Compile-time only: the shape `findDuplicate` promises its callers. */
const _duplicateShape: DuplicateContact = { _id: new Types.ObjectId() };
void _duplicateShape;
