import {
  parseContactsCsv,
  parseHouseholdsCsv,
  parsePoliciesCsv,
  splitRecIds,
  splitTitles,
} from './smartsuite-csv';

const CONTACT_HEADER =
  'SS Contact ID,Record ID,Household Primary Contact,Household Member,' +
  'Role in Household,First Name,Last Name,Date of Birth,Phone,Email,' +
  'primary household rec id,household member rec id';

/** One contact row, in column order, quoted where the value holds a comma. */
function contactRow(parts: Partial<Record<number, string>>): string {
  const cells = Array.from({ length: 12 }, (_, i) => parts[i] ?? '');
  return cells.map((c) => (c.includes(',') ? `"${c}"` : c)).join(',');
}

describe('separator splitting', () => {
  it('splits rec-id columns on the pipe, not the comma', () => {
    expect(splitRecIds('aaa | bbb | ccc')).toEqual(['aaa', 'bbb', 'ccc']);
    // The bug this guards: a comma inside a rec-id column is not a separator.
    expect(splitRecIds('aaa,bbb')).toEqual(['aaa,bbb']);
  });

  it('splits title columns on the comma', () => {
    expect(splitTitles('#HH3932, #HH4717')).toEqual(['#HH3932', '#HH4717']);
  });

  it('treats an empty column as no values', () => {
    expect(splitRecIds('')).toEqual([]);
    expect(splitRecIds(undefined)).toEqual([]);
    expect(splitTitles('   ')).toEqual([]);
  });
});

describe('parseContactsCsv', () => {
  it('reads a single-membership row through the BOM on the header', () => {
    const csv =
      '\ufeff' +
      CONTACT_HEADER +
      '\n' +
      contactRow({
        0: '#C00716',
        1: '6965c6c07d8840991b728cb3',
        2: '#HH3803',
        3: '#HH3803',
        4: 'Named Insured',
        5: 'Jerry',
        6: 'Ailey',
        10: '6965c42698f8cd8ca7442acb',
        11: '6965c42698f8cd8ca7442acb',
      });

    const rows = parseContactsCsv(csv);
    const row = rows.get('6965c6c07d8840991b728cb3');
    expect(row).toBeDefined();
    // Without `bom: true` the first column key is U+FEFF + "SS Contact ID",
    // and this reads as an empty ref on every row of the file.
    expect(row!.contactRef).toBe('#C00716');
    expect(row!.primaryHouseholdIds).toEqual(['6965c42698f8cd8ca7442acb']);
    expect(row!.memberHouseholdIds).toEqual(['6965c42698f8cd8ca7442acb']);
    expect(row!.roleInHousehold).toBe('Named Insured');
  });

  it('reads a contact who is a member of three households', () => {
    const csv =
      CONTACT_HEADER +
      '\n' +
      contactRow({
        0: '#C02641',
        1: 'rec-c',
        3: '#HH4357, #HH4765, #HH4356',
        11: 'hh-a | hh-b | hh-c',
      });

    const row = parseContactsCsv(csv).get('rec-c')!;
    expect(row.memberHouseholdIds).toEqual(['hh-a', 'hh-b', 'hh-c']);
    expect(row.memberHouseholdRefs).toHaveLength(3);
    expect(row.primaryHouseholdIds).toEqual([]);
  });

  it('keeps both households of a contact primary of two', () => {
    const csv =
      CONTACT_HEADER +
      '\n' +
      contactRow({
        0: '#C01036',
        1: 'rec-adeyemi',
        2: '#HH3932, #HH4717',
        10: 'hh-3932 | hh-4717',
      });

    expect(
      parseContactsCsv(csv).get('rec-adeyemi')!.primaryHouseholdIds,
    ).toEqual(['hh-3932', 'hh-4717']);
  });

  it('leaves an unlinked contact with no household on either side', () => {
    const csv =
      CONTACT_HEADER +
      '\n' +
      contactRow({ 0: '#C00001', 1: 'rec-x', 5: 'Sample' });
    const row = parseContactsCsv(csv).get('rec-x')!;
    expect(row.primaryHouseholdIds).toEqual([]);
    expect(row.memberHouseholdIds).toEqual([]);
    expect(row.email).toBeUndefined();
  });

  it('throws when a title column and its rec-id column disagree', () => {
    const csv =
      CONTACT_HEADER +
      '\n' +
      // Two titles, one rec id: the separator convention has changed.
      contactRow({ 0: '#C09999', 1: 'rec-y', 2: '#HH1, #HH2', 10: 'hh-1' });
    expect(() => parseContactsCsv(csv)).toThrow(/#C09999/);
  });

  it('throws when an expected column is absent', () => {
    expect(() => parseContactsCsv('Record ID,First Name\nrec-z,Jo')).toThrow(
      /missing expected column/i,
    );
  });
});

describe('parseHouseholdsCsv', () => {
  it('splits the comma-separated policy numbers', () => {
    const csv =
      'SS Household ID,Record ID,Property Address,Link to Policies\n' +
      '#HH4347,697b8e398d9b1aad97435cc3,"Edmond, OK, 73034-9639, US",' +
      '"947550848, 947268919"';
    const row = parseHouseholdsCsv(csv).get('697b8e398d9b1aad97435cc3')!;
    expect(row.householdRef).toBe('#HH4347');
    expect(row.policyNumbers).toEqual(['947550848', '947268919']);
    expect(row.propertyAddress).toBe('Edmond, OK, 73034-9639, US');
  });
});

describe('parsePoliciesCsv', () => {
  it('reads the household rec id and title', () => {
    const csv =
      'Policy Number,Record ID,Household Rec Id,Carrier,Policy Type,Household,' +
      'Premium,Policy Status,Items\n' +
      '0120000,6957ed74aef93dc425a59525,6956fa51c7f95eec52a45c91,Allstate,Home,' +
      '#HH0017,,,';
    const row = parsePoliciesCsv(csv).get('6957ed74aef93dc425a59525')!;
    expect(row.policyNumber).toBe('0120000');
    expect(row.householdRecordId).toBe('6956fa51c7f95eec52a45c91');
    expect(row.householdRef).toBe('#HH0017');
    expect(row.premium).toBeUndefined();
  });

  it('leaves an unlinked policy with no household', () => {
    const csv =
      'Policy Number,Record ID,Household Rec Id,Carrier,Policy Type,Household,' +
      'Premium,Policy Status,Items\n' +
      '856719796,6968735d3852d860110a1024,,Allstate,Auto,,774.09,Active,3';
    const row = parsePoliciesCsv(csv).get('6968735d3852d860110a1024')!;
    expect(row.householdRecordId).toBeUndefined();
    expect(row.premium).toBe('774.09');
  });
});
