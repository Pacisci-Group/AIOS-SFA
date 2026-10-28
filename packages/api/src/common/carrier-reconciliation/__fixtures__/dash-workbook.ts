import * as XLSX from 'xlsx';
import type { DashRow } from '../dash-file-reader';
import type { AppPolicyLite } from '../reconcile';

/**
 * A synthetic Dash export, laid out like the real one: metadata rows, two
 * pivot-filter rows, then the 25-column header (two `Channel` columns, stray
 * trailing spaces). Every name and number here is invented.
 */
export const DASH_HEADER = [
  'Agent Number',
  'Sub Producer',
  'Sub-Producer Name',
  'Bind ID',
  'Bind ID Name',
  'Policy No',
  'Customer Name',
  'Issued Date',
  'Date Written',
  'Year',
  'Month ',
  'Product',
  'Line Group',
  'Product Description ',
  'Package',
  'Transaction Type',
  'Item Count',
  'Written Premium',
  'Disposition Code',
  'Channel',
  'Channel Indicator',
  'ADJ. Code',
  'Scenario Name',
  'Facility Auto',
  'Channel',
];

export interface DashLine {
  sub?: string | number;
  subName?: string;
  bindId?: string;
  bindName?: string;
  policyNo?: string | number;
  customer?: string;
  issued?: string | number;
  written?: string | number;
  product?: string;
  transaction?: string;
  items?: number;
  premium?: number | string;
  disposition?: string;
  channel?: string;
}

export function dashLine(line: DashLine): unknown[] {
  return [
    '0X1234',
    line.sub ?? '034',
    line.subName ?? 'PAT PRODUCER',
    line.bindId ?? 'SOKAAAA1',
    line.bindName ?? 'PAT PRODUCER',
    line.policyNo ?? '900000001',
    line.customer ?? 'CASEY CUSTOMER',
    line.issued ?? '09/02/2026',
    line.written ?? '09/02/2026',
    2026,
    9,
    line.product ?? 'Standard Auto',
    '330-OK-0001',
    line.product ?? 'Standard Auto',
    '',
    line.transaction ?? 'New Issued Transaction - First Term',
    line.items ?? 1,
    line.premium ?? 1000,
    line.disposition ?? 'New Policy Issued',
    line.channel ?? 'Agency',
    'Agency',
    '',
    'Scenario',
    'Without Facility Auto',
    line.channel ?? 'Agency',
  ];
}

export function dashWorkbook({
  lines,
  meta = true,
  scratchFirst = false,
  header = DASH_HEADER,
  blankRowInMeta = false,
}: {
  lines: unknown[][];
  meta?: boolean;
  scratchFirst?: boolean;
  header?: string[];
  /** A fully empty row between the metadata lines — a hole in the sheet. */
  blankRowInMeta?: boolean;
}): Buffer {
  const above = meta
    ? [
        ['New Business Details'],
        ['Download Date', 'Mon, 12 Oct 2026 03:39:31 GMT'],
        ['Downloaded By', 'SOKOWNER - '],
        ...(blankRowInMeta ? [[]] : []),
        ['Agent', '0X1234 - OWNER, OLIVE'],
        ['Start Date', '09/01/2026'],
        ['End Date', '09/30/2026'],
        ['Product Category', 'All', null, null, 'Policy Start date'],
        [null, null, 'X', 'x'],
      ]
    : [];
  const workbook = XLSX.utils.book_new();
  if (scratchFirst) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['Row Labels', 'Sum of Written Premium']]),
      'Sheet2',
    );
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([...above, header, ...lines]),
    'New Business Details',
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** A parsed Dash row with sensible defaults, for engine tests. */
export function dashRow(overrides: Partial<DashRow> = {}): DashRow {
  const policyNumber = overrides.policyNumber ?? '900000001';
  return {
    rowNumber: 10,
    agentNumber: '0X1234',
    subProducerCode: '034',
    subProducerName: 'PAT PRODUCER',
    bindId: 'SOKAAAA1',
    bindIdKey: 'SOKAAAA1',
    bindIdName: 'PAT PRODUCER',
    policyNumber,
    policyKey: policyNumber.replace(/\D/g, ''),
    customerName: 'CASEY CUSTOMER',
    issuedDate: '2026-09-02',
    dateWritten: '2026-09-02',
    product: 'Standard Auto',
    productDescription: 'Standard Auto',
    lineGroup: '330-OK-0001',
    packageName: null,
    transactionType: 'New Issued Transaction - First Term',
    dispositionCode: 'New Policy Issued',
    itemCount: 1,
    writtenPremium: 1000,
    channel: 'Agency',
    channelIndicator: 'Agency',
    scenarioName: null,
    ...overrides,
  };
}

/** An app policy with sensible defaults, for engine tests. */
export function appPolicy(
  overrides: Partial<AppPolicyLite> = {},
): AppPolicyLite {
  const policyNumber = overrides.policyNumber ?? '900000001';
  return {
    policyId: 'p1',
    policyNumber,
    policyKey: policyNumber ? policyNumber.replace(/\D/g, '') : '',
    policyType: 'Auto',
    carrier: 'Allstate',
    policyStatus: 'Active',
    premium: 1000,
    items: 1,
    dealId: 'd1',
    householdId: 'h1',
    producerId: 'u-pat',
    soldDay: '2026-09-02',
    clientName: 'Casey Customer',
    businessType: 'new_business',
    expectedInDash: true,
    nearWindow: true,
    ...overrides,
  };
}
