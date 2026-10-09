import { Types } from 'mongoose';
import {
  HOUSEHOLD_LOOKUP,
  prefixNeeds,
  quotedBreakdownStages,
  rowKey,
  SALES_DIMENSIONS,
  soldBreakdownStages,
} from './sales-dimensions';

type Facet = { $facet: Record<string, Record<string, unknown>[]> };
const facetOf = (stages: object[]) =>
  (stages.find((stage) => '$facet' in stage) as Facet).$facet;

describe('sales dimensions', () => {
  it('unwinds policy lines only for the per-policy dimensions', () => {
    const perLine = Object.values(SALES_DIMENSIONS)
      .filter((d) => d.perLine)
      .map((d) => d.key)
      .sort();
    expect(perLine).toEqual(['carrier', 'policyType']);

    const byLine = facetOf(
      soldBreakdownStages(SALES_DIMENSIONS.policyType, null),
    );
    expect(byLine.rows[0]).toEqual({ $unwind: '$lines' });
    const byProducer = facetOf(
      soldBreakdownStages(SALES_DIMENSIONS.producer, null),
    );
    expect(byProducer.rows[0]).toHaveProperty('$group');
  });

  it('always totals at record level, so sales and households stay distinct', () => {
    const facet = facetOf(soldBreakdownStages(SALES_DIMENSIONS.carrier, null));
    expect(facet.total).toHaveLength(1);
    expect(JSON.stringify(facet.total)).toContain('"$linePremium"');
    expect(JSON.stringify(facet.total)).toContain('"net"');
  });

  it('splits rows by a segment, unwinding when either side is per policy', () => {
    const facet = facetOf(
      soldBreakdownStages(
        SALES_DIMENSIONS.producer,
        SALES_DIMENSIONS.policyType,
      ),
    );
    expect(facet.segments[0]).toEqual({ $unwind: '$lines' });
    expect(facet.segments[1]).toMatchObject({
      $group: {
        _id: {
          k: SALES_DIMENSIONS.producer.sold,
          s: SALES_DIMENSIONS.policyType.sold,
        },
      },
    });
    // The rows themselves stay record-level: net premium is still a sale's.
    expect(facet.rows[0]).toHaveProperty('$group');
  });

  it('looks the household up once, only for ZIP and CSR', () => {
    expect(soldBreakdownStages(SALES_DIMENSIONS.zip, null)[0]).toBe(
      HOUSEHOLD_LOOKUP,
    );
    expect(
      soldBreakdownStages(SALES_DIMENSIONS.branch, null).includes(
        HOUSEHOLD_LOOKUP,
      ),
    ).toBe(false);
    expect(
      prefixNeeds([SALES_DIMENSIONS.csr, SALES_DIMENSIONS.carrier]),
    ).toEqual({ withSource: false, carrier: true, household: true });
  });

  it('has no quote side for carrier — a quote recaps no carrier', () => {
    expect(SALES_DIMENSIONS.carrier.quoted).toBeNull();
    expect(quotedBreakdownStages(SALES_DIMENSIONS.carrier)).toEqual([]);
    expect(quotedBreakdownStages(SALES_DIMENSIONS.zip).length).toBeGreaterThan(
      0,
    );
  });

  it('resolves lead source through the lead', () => {
    expect(prefixNeeds([SALES_DIMENSIONS.leadSource]).withSource).toBe(true);
  });
});

describe('rowKey', () => {
  it('folds a SmartSuite code into its policy type', () => {
    expect(rowKey('policyType', 'PYgez')).toEqual(rowKey('policyType', 'Auto'));
  });

  it('keys carriers by slug, alias codes included', () => {
    expect(rowKey('carrier', 'B4tEH')).toEqual({
      key: 'allstate',
      label: 'Allstate',
    });
    expect(rowKey('carrier', ' Allstate ').key).toBe('allstate');
  });

  it('keys ids as hex strings, leaving the label to the batch lookup', () => {
    const id = new Types.ObjectId();
    expect(rowKey('producer', id)).toEqual({
      key: id.toHexString(),
      label: null,
    });
  });

  it('puts missing and blank keys in the null bucket', () => {
    expect(rowKey('zip', null)).toEqual({ key: null, label: null });
    expect(rowKey('zip', '  ')).toEqual({ key: null, label: null });
    expect(rowKey('policyType', '')).toEqual({ key: null, label: null });
  });
});
