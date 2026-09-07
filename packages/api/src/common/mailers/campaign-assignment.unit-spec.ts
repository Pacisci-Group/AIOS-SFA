import {
  BLANK_CARRIER_CODE,
  resolveAssignment,
  unmatchedCodeMessage,
  visibleAgencyIdsFor,
  type AgencyAppointmentModel,
  type AppointmentAgencyRow,
} from './campaign-assignment';

/**
 * Who each row belongs to (PAC-71).
 *
 * The cases that matter are the ones where the *absence* of a match must be
 * distinguishable from a match on "everybody": `byCodeKey[key] === null` means
 * every agency, and `key` being **absent** means unassignable. The import
 * engine reads exactly that difference, so a test that only checked "returns an
 * array" would let a mis-assignment through.
 */

const ALLSTATE = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const OTHER_CARRIER = 'b2b2b2b2b2b2b2b2b2b2b2b2';
const SMITH = '111111111111111111111111';

/** A model that records the filter it was handed. */
function fakeAgencies(rows: AppointmentAgencyRow[]) {
  const filters: Record<string, unknown>[] = [];
  const model: AgencyAppointmentModel = {
    find: (filter) => {
      filters.push(filter);
      return {
        select: () => ({ lean: () => Promise.resolve(rows) }),
      };
    },
  };
  return { model, filters };
}

const smithHoldsA0B9049: AppointmentAgencyRow = {
  _id: SMITH,
  name: 'Smith Family Agency',
  carrierAppointments: [
    { carrierId: ALLSTATE, codeKey: 'A0B9049', active: true },
  ],
};

describe('resolveAssignment — carrier_agency_id', () => {
  const assignment = { mode: 'carrier_agency_id' as const, agencyIds: [] };

  it('routes each code to the agency holding that appointment', async () => {
    const { model, filters } = fakeAgencies([smithHoldsA0B9049]);

    const result = await resolveAssignment(
      model,
      { carrierId: ALLSTATE, assignment },
      { A0B9049: 20024 },
    );

    expect(result.byCodeKey).toEqual({ A0B9049: [SMITH] });
    expect(result.unmatched).toEqual([]);
    expect(result.resolved).toEqual([
      {
        codeKey: 'A0B9049',
        agencyId: SMITH,
        agencyName: 'Smith Family Agency',
        rows: 20024,
      },
    ]);
    // `$elemMatch`, not two dotted paths — see the note at the call site.
    expect(filters[0]).toEqual({
      carrierAppointments: {
        $elemMatch: {
          carrierId: ALLSTATE,
          codeKey: { $in: ['A0B9049'] },
          active: true,
        },
      },
    });
  });

  it('leaves an unmatched code out of the map rather than mapping it to nobody', async () => {
    const { model } = fakeAgencies([]);

    const result = await resolveAssignment(
      model,
      { carrierId: ALLSTATE, assignment },
      { A0B9049: 12, ZZZZZZZ: 3 },
    );

    // The distinction the import engine depends on: absent, never `[]`.
    expect(result.byCodeKey).toEqual({});
    expect('A0B9049' in result.byCodeKey).toBe(false);
    expect(result.unmatched).toEqual(['A0B9049', 'ZZZZZZZ']);
    expect(result.resolved.map((row) => row.agencyId)).toEqual([null, null]);
  });

  it('treats a blank agency code as unassignable, and never queries for it', async () => {
    const { model, filters } = fakeAgencies([smithHoldsA0B9049]);

    const result = await resolveAssignment(
      model,
      { carrierId: ALLSTATE, assignment },
      { A0B9049: 5, [BLANK_CARRIER_CODE]: 2 },
    );

    expect(result.unmatched).toEqual([BLANK_CARRIER_CODE]);
    expect(result.byCodeKey).toEqual({ A0B9049: [SMITH] });
    // A blank code can never match an appointment; sending it would be an index
    // seek that provably returns nothing.
    expect(
      (
        filters[0].carrierAppointments as {
          $elemMatch: { codeKey: { $in: string[] } };
        }
      ).$elemMatch.codeKey.$in,
    ).toEqual(['A0B9049']);
  });

  it('ignores an inactive appointment and one from another carrier', async () => {
    const { model } = fakeAgencies([
      {
        _id: SMITH,
        name: 'Smith Family Agency',
        carrierAppointments: [
          // Same code, wrong carrier — a code only means anything inside its own.
          { carrierId: OTHER_CARRIER, codeKey: 'A0B9049', active: true },
          { carrierId: ALLSTATE, codeKey: 'A0B9049', active: false },
        ],
      },
    ]);

    const result = await resolveAssignment(
      model,
      { carrierId: ALLSTATE, assignment },
      { A0B9049: 5 },
    );

    expect(result.unmatched).toEqual(['A0B9049']);
    expect(result.byCodeKey).toEqual({});
  });

  it('survives an agency created before carrier appointments existed', async () => {
    // `.lean()` applies no schema defaults, so the field reads as `undefined`.
    const { model } = fakeAgencies([{ _id: SMITH, name: 'Legacy Agency' }]);

    const result = await resolveAssignment(
      model,
      { carrierId: ALLSTATE, assignment },
      { A0B9049: 5 },
    );

    expect(result.unmatched).toEqual(['A0B9049']);
  });

  it('does not query at all when the file carries only blank codes', async () => {
    const { model, filters } = fakeAgencies([]);

    const result = await resolveAssignment(
      model,
      { carrierId: ALLSTATE, assignment },
      { [BLANK_CARRIER_CODE]: 9 },
    );

    expect(filters).toHaveLength(0);
    expect(result.unmatched).toEqual([BLANK_CARRIER_CODE]);
  });
});

describe('resolveAssignment — operator overrides', () => {
  it('gives every row the named agencies', async () => {
    const { model, filters } = fakeAgencies([]);

    const result = await resolveAssignment(
      model,
      {
        carrierId: ALLSTATE,
        assignment: { mode: 'agencies', agencyIds: [SMITH, 'other'] },
      },
      { A0B9049: 5, ZZZZZZZ: 1 },
    );

    expect(result.byCodeKey).toEqual({
      A0B9049: [SMITH, 'other'],
      ZZZZZZZ: [SMITH, 'other'],
    });
    // A code no agency holds is not a problem when nobody is routing on it.
    expect(result.unmatched).toEqual([]);
    expect(filters).toHaveLength(0);
  });

  it('stores an explicit null for "all agencies"', async () => {
    const { model } = fakeAgencies([]);

    const result = await resolveAssignment(
      model,
      { carrierId: ALLSTATE, assignment: { mode: 'all', agencyIds: [] } },
      { A0B9049: 5 },
    );

    // ⚠ `null`, not `[]`. `[]` would mean "visible to nobody".
    expect(result.byCodeKey).toEqual({ A0B9049: null });
    expect(result.unmatched).toEqual([]);
  });
});

describe('visibleAgencyIdsFor', () => {
  it('answers "every agency" for any code in `all` mode, mapped or not', () => {
    const resolve = visibleAgencyIdsFor(
      { mode: 'all', agencyIds: [] },
      { A0B9049: null },
    );
    expect(resolve('A0B9049')).toBeNull();
    // The case the short-circuit exists for: a code the preview never saw must
    // not be rejected in a mode that means "everyone".
    expect(resolve('NEWCODE')).toBeNull();
    expect(resolve(null)).toBeNull();
  });

  it('fails closed on an unknown code when routing by carrier code', () => {
    const resolve = visibleAgencyIdsFor(
      { mode: 'carrier_agency_id', agencyIds: [] },
      { A0B9049: [SMITH] },
    );
    expect(resolve('A0B9049')).toEqual([SMITH]);
    // `undefined` is what the import engine turns into a counted rejection.
    expect(resolve('ZZZZZZZ')).toBeUndefined();
    expect(resolve(null)).toBeUndefined();
  });

  it('ignores the code entirely when the operator named the agencies', () => {
    const resolve = visibleAgencyIdsFor(
      { mode: 'agencies', agencyIds: [SMITH] },
      {},
    );
    expect(resolve('ANYTHING')).toEqual([SMITH]);
    expect(resolve(null)).toEqual([SMITH]);
  });
});

describe('unmatchedCodeMessage', () => {
  it('names both fixes, not just the fault', () => {
    const message = unmatchedCodeMessage('A0B9049', 20024, 'Allstate');
    expect(message).toContain('A0B9049');
    expect(message).toContain('20,024 rows');
    expect(message).toContain('Add the appointment');
    expect(message).toContain('Specific agencies');
  });

  it('reads as English for a row carrying no code', () => {
    expect(unmatchedCodeMessage(BLANK_CARRIER_CODE, 2, 'Allstate')).toContain(
      'no agency code',
    );
  });
});
