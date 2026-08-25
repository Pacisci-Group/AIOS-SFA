import {
  detectFromRow,
  mapMailerRow,
  normalizeHeader,
  normalizeRow,
  type MailerMapContext,
} from './mailer-row.mapper';

const CTX: MailerMapContext = {
  agencyId: 'agency-1',
  system: 'spreadsheet',
  runId: 'run-1',
};

/** A row in the shape the CSV ships it, headers not yet normalized. */
const CSV_ROW = {
  controlno: '#3f2a91c7-4d5e-4b8a-9f10-9c41b2d70e58',
  'New Control Number': '9c41b2d70e58',
  firstname: 'Dana',
  lastname: 'Okafor',
  name: 'Dana Okafor',
  gender: 'F',
  emailaddre: '',
  phone: '',
  birthdate: '',
  address: '1420 S Cheyenne Ave',
  city: 'Bartlesville',
  state: 'OK',
  zip: '74003-5807',
  zip1: '74003',
  zip2: '5807',
  county: '017',
  squarefeet: '4195',
  filler: '4,195',
  yearbuilt: '1998',
  dwellingli: '$899,675.00',
  otherlimit: '$89,967.50',
  livingexpl: '$89,967.50',
  guestlimit: '$1,000.00/person',
  familylimi: '$100,000.00/occurrence',
  totalpremi: '3096.65',
  yearlyprem: '$1886.15/year*',
  monthlypre: '157.18',
  'New Yearly Premium 2': '1886.15',
  'Campaign Number': 'Week_Number-29',
  FileName: 'SFA-20P',
  type: 'Home',
  product: 'FQ',
  quotestatu: '2',
  quotedate: '46216',
  Right_Name: 'Tulsa',
  agencyphon: '918-984-6163',
  agencyid: 'A0B9049',
  agencyname: 'SMITH FAMILY AGENCY',
  donotcall: 'No',
  donotmail: 'Yes',
  deductible: '0.01',
  recordid: '1',
  vehicle1: '',
};

describe('normalizeHeader', () => {
  it('collapses the CSV and BigQuery spellings onto one key', () => {
    // This is the whole mechanism that lets one mapper serve both sources.
    expect(normalizeHeader('New Control Number')).toBe('newcontrolnumber');
    expect(normalizeHeader('New_Control_Number')).toBe('newcontrolnumber');
    expect(normalizeHeader('Campaign Number')).toBe('campaignnumber');
    expect(normalizeHeader('Campaign_Number')).toBe('campaignnumber');
    expect(normalizeHeader('Right_Name')).toBe('rightname');
  });
});

describe('mapMailerRow', () => {
  const result = mapMailerRow(normalizeRow(CSV_ROW), CTX);
  if (!result.ok) throw new Error(`expected a mapped row: ${result.reason}`);
  const { doc, keys, primaryKey } = result.mapped;

  it('stores both control-number forms, long one as the upsert key', () => {
    expect(keys).toEqual(['3F2A91C74D5E4B8A9F109C41B2D70E58', '9C41B2D70E58']);
    expect(primaryKey).toBe('3F2A91C74D5E4B8A9F109C41B2D70E58');
  });

  it('keeps county a zero-padded string, not a number', () => {
    expect((doc.address as Record<string, unknown>).county).toBe('017');
  });

  it('stores square footage as a number', () => {
    expect(doc.squareFeet).toBe(4195);
    expect(doc.yearBuilt).toBe(1998);
  });

  it('converts the Excel-serial quote date', () => {
    expect((doc.quoteDate as Date).toISOString().slice(0, 10)).toBe(
      '2026-07-13',
    );
  });

  it('coerces every money format, with no NaN', () => {
    expect(doc.coverage).toEqual({
      dwelling: 899675,
      otherStructures: 89967.5,
      lossOfUse: 89967.5,
      guestMedical: 1000,
      familyLiability: 100000,
    });
    expect(doc.premium).toEqual({
      total: 3096.65,
      yearly: 1886.15,
      monthly: 157.18,
      newYearly: 1886.15,
    });
  });

  it('derives the week number from the campaign number', () => {
    expect(doc.campaign).toMatchObject({
      campaignNumber: 'Week_Number-29',
      weekNumber: 29,
      fileName: 'SFA-20P',
      policyType: 'Home',
      product: 'FQ',
    });
  });

  it('leaves BigQuery-only campaign columns absent rather than inventing them', () => {
    const campaign = doc.campaign as Record<string, unknown>;
    expect(campaign.campaignStatus).toBeUndefined();
    expect(campaign.mailDropDate).toBeUndefined();
  });

  it('omits the contact fields that are empty on ~100% of real rows', () => {
    // Anything downstream must render cleanly with none of these.
    expect(doc.email).toBeUndefined();
    expect(doc.phone).toBeUndefined();
    expect(doc.dateOfBirth).toBeUndefined();
  });

  it('carries the suppression flags through', () => {
    expect(doc.doNotMail).toBe(true);
    expect(doc.doNotCall).toBe(false);
  });

  it('keeps unpromoted columns in source.raw and drops empty ones', () => {
    const raw = (doc.source as Record<string, unknown>).raw as Record<
      string,
      unknown
    >;
    expect(raw.deductible).toBe('0.01');
    expect(raw.filler).toBe('4,195');
    expect(raw.recordid).toBe('1');
    // Empty Auto columns are dropped from raw but must not narrow the schema —
    // an Auto RTP file populates them.
    expect(raw.vehicle1).toBeUndefined();
    // Promoted columns are not duplicated into raw.
    expect(raw.controlno).toBeUndefined();
    expect(raw.dwellingli).toBeUndefined();
  });

  it('rejects a row with no usable control number, with a reason', () => {
    const rejected = mapMailerRow(
      normalizeRow({ ...CSV_ROW, controlno: '', 'New Control Number': '' }),
      CTX,
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.reason).toMatch(/control number/i);
  });

  it('rounds the float artifact rather than treating it as bad data', () => {
    // yearlyprem '$2704.91/year*' vs New Yearly Premium 2 '2704.915' — 3 rows
    // of 20,405 disagree this way.
    const artifact = mapMailerRow(
      normalizeRow({
        ...CSV_ROW,
        yearlyprem: '$2704.91/year*',
        'New Yearly Premium 2': '2704.915',
      }),
      CTX,
    );
    if (!artifact.ok) throw new Error('expected a mapped row');
    const premium = artifact.mapped.doc.premium as Record<string, number>;
    expect(premium.yearly).toBe(2704.91);
    expect(premium.newYearly).toBe(2704.92);
  });
});

describe('cross-source equivalence', () => {
  /**
   * The same mailer, spelled the way BigQuery spells it: underscored headers,
   * plus the columns that exist only there.
   */
  const BQ_ROW = {
    controlno: CSV_ROW.controlno,
    New_Control_Number: CSV_ROW['New Control Number'],
    firstname: CSV_ROW.firstname,
    lastname: CSV_ROW.lastname,
    name: CSV_ROW.name,
    gender: CSV_ROW.gender,
    address: CSV_ROW.address,
    city: CSV_ROW.city,
    state: CSV_ROW.state,
    zip: CSV_ROW.zip,
    zip1: CSV_ROW.zip1,
    zip2: CSV_ROW.zip2,
    county: CSV_ROW.county,
    squarefeet: CSV_ROW.squarefeet,
    yearbuilt: CSV_ROW.yearbuilt,
    dwellingli: CSV_ROW.dwellingli,
    otherlimit: CSV_ROW.otherlimit,
    livingexpl: CSV_ROW.livingexpl,
    guestlimit: CSV_ROW.guestlimit,
    familylimi: CSV_ROW.familylimi,
    totalpremi: CSV_ROW.totalpremi,
    yearlyprem: CSV_ROW.yearlyprem,
    monthlypre: CSV_ROW.monthlypre,
    New_Yearly_Premium_2: CSV_ROW['New Yearly Premium 2'],
    Campaign_Number: CSV_ROW['Campaign Number'],
    FileName: CSV_ROW.FileName,
    type: CSV_ROW.type,
    product: CSV_ROW.product,
    quotestatu: CSV_ROW.quotestatu,
    quotedate: CSV_ROW.quotedate,
    Right_Name: CSV_ROW.Right_Name,
    agencyphon: CSV_ROW.agencyphon,
    donotcall: CSV_ROW.donotcall,
    donotmail: CSV_ROW.donotmail,
    // BigQuery-only columns.
    week_number: '29',
    campaign_status: 'Closed',
    mail_drop_date: '2026-07-13',
  };

  it('produces the same identity, coverage and premium from either source', () => {
    const csv = mapMailerRow(normalizeRow(CSV_ROW), CTX);
    const bq = mapMailerRow(normalizeRow(BQ_ROW), {
      ...CTX,
      system: 'bigquery',
    });
    if (!csv.ok || !bq.ok) throw new Error('expected both rows to map');

    expect(bq.mapped.keys).toEqual(csv.mapped.keys);
    expect(bq.mapped.doc.coverage).toEqual(csv.mapped.doc.coverage);
    expect(bq.mapped.doc.premium).toEqual(csv.mapped.doc.premium);
    expect(bq.mapped.doc.address).toEqual(csv.mapped.doc.address);
    expect(bq.mapped.doc.quoteDate).toEqual(csv.mapped.doc.quoteDate);
  });

  it('populates the BigQuery-only campaign columns without requiring them', () => {
    const bq = mapMailerRow(normalizeRow(BQ_ROW), {
      ...CTX,
      system: 'bigquery',
    });
    if (!bq.ok) throw new Error('expected a mapped row');
    expect(bq.mapped.doc.campaign).toMatchObject({
      weekNumber: 29,
      campaignStatus: 'Closed',
    });
  });
});

describe('detectFromRow', () => {
  it('reads what the file says about itself', () => {
    expect(detectFromRow(normalizeRow(CSV_ROW))).toEqual({
      agencyId: 'A0B9049',
      agencyName: 'SMITH FAMILY AGENCY',
      campaignNumber: 'Week_Number-29',
      weekNumber: 29,
      fileName: 'SFA-20P',
      quoteDate: '2026-07-13T00:00:00.000Z',
      policyType: 'Home',
      product: 'FQ',
    });
  });
});
