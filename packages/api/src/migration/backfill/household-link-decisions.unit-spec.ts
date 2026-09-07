import { Types } from 'mongoose';
import {
  buildHouseholdMembership,
  decideLink,
  pickTargetHousehold,
} from './household-link-decisions';
import type { ContactCsvRow } from './smartsuite-csv';

function contact(overrides: Partial<ContactCsvRow> = {}): ContactCsvRow {
  return {
    contactRef: '#C00001',
    recordId: 'rec-1',
    primaryHouseholdIds: [],
    primaryHouseholdRefs: [],
    memberHouseholdIds: [],
    memberHouseholdRefs: [],
    ...overrides,
  };
}

describe('decideLink — fill, never move', () => {
  const fromExport = new Types.ObjectId();

  it('fills an empty field', () => {
    expect(decideLink(undefined, fromExport)).toBe('fill');
    expect(decideLink(null, fromExport)).toBe('fill');
  });

  it('is a no-op when the stored value already agrees', () => {
    // The re-run case: this is why a second run reports zero fills.
    expect(decideLink(new Types.ObjectId(fromExport), fromExport)).toBe(
      'already-correct',
    );
  });

  it('reports a disagreement instead of overwriting it', () => {
    // An employee re-linked the record after go-live; the export is stale.
    expect(decideLink(new Types.ObjectId(), fromExport)).toBe('conflict');
  });
});

describe('pickTargetHousehold', () => {
  const none = new Set<string>();

  it('prefers the household the contact is primary of', () => {
    expect(
      pickTargetHousehold(
        contact({
          primaryHouseholdIds: ['hh-primary'],
          memberHouseholdIds: ['hh-member'],
        }),
        none,
      ),
    ).toEqual({ kind: 'ok', legacyHouseholdId: 'hh-primary' });
  });

  it('falls back to the first membership', () => {
    expect(
      pickTargetHousehold(
        contact({ memberHouseholdIds: ['hh-a', 'hh-b'] }),
        none,
      ),
    ).toEqual({ kind: 'ok', legacyHouseholdId: 'hh-a' });
  });

  it('reports a contact the export links to nothing', () => {
    expect(pickTargetHousehold(contact(), none)).toEqual({
      kind: 'unlinked-in-source',
    });
  });

  it('skips a household the owner decided to remove', () => {
    // Adeyemi: primary of both #HH3932 and the removed #HH4717.
    expect(
      pickTargetHousehold(
        contact({ primaryHouseholdIds: ['hh-3932', 'hh-4717'] }),
        new Set(['hh-4717']),
      ),
    ).toEqual({ kind: 'ok', legacyHouseholdId: 'hh-3932' });
  });

  it('leaves a contact unlinked when every candidate is removed', () => {
    expect(
      pickTargetHousehold(
        contact({ memberHouseholdIds: ['hh-0032'] }),
        new Set(['hh-0032']),
      ),
    ).toEqual({ kind: 'target-removed' });
  });
});

describe('buildHouseholdMembership', () => {
  it('unions both link columns per household', () => {
    // The 266-contact case: primary of a household that does not list them.
    const { primaryContactsFor, memberContactsFor } = buildHouseholdMembership([
      contact({ recordId: 'c-1', primaryHouseholdIds: ['hh-1'] }),
      contact({ recordId: 'c-2', memberHouseholdIds: ['hh-1'] }),
    ]);

    expect(primaryContactsFor.get('hh-1')).toEqual(['c-1']);
    expect([...memberContactsFor.get('hh-1')!]).toEqual(['c-1', 'c-2']);
  });

  it('does not list a contact twice for one household', () => {
    const { memberContactsFor } = buildHouseholdMembership([
      contact({
        recordId: 'c-1',
        primaryHouseholdIds: ['hh-1'],
        memberHouseholdIds: ['hh-1'],
      }),
    ]);
    expect([...memberContactsFor.get('hh-1')!]).toEqual(['c-1']);
  });

  it('keeps both households of a contact primary of two', () => {
    const { primaryContactsFor } = buildHouseholdMembership([
      contact({ recordId: 'c-1', primaryHouseholdIds: ['hh-a', 'hh-b'] }),
    ]);
    expect(primaryContactsFor.get('hh-a')).toEqual(['c-1']);
    expect(primaryContactsFor.get('hh-b')).toEqual(['c-1']);
  });

  it('collects the two contacts that claim one household as primary', () => {
    // Ambiguous: the script reports it and leaves `primaryContactId` unset.
    const { primaryContactsFor } = buildHouseholdMembership([
      contact({ recordId: 'c-1', primaryHouseholdIds: ['hh-1'] }),
      contact({ recordId: 'c-2', primaryHouseholdIds: ['hh-1'] }),
    ]);
    expect(primaryContactsFor.get('hh-1')).toEqual(['c-1', 'c-2']);
  });
});
