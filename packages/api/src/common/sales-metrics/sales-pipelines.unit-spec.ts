import type { PipelineStage } from 'mongoose';
import {
  carrierValues,
  linesPrefix,
  QUOTED_LINES,
  SOLD_LINES,
} from './sales-pipelines';

const MATCH = { agencyId: 'a1' };

/** The `$lookup` stage's inner `$project`. */
function lookupProjection(stages: PipelineStage[]) {
  const lookup = stages.find((stage) => '$lookup' in stage) as {
    $lookup: { pipeline: Record<string, unknown>[] };
  };
  return lookup.$lookup.pipeline[1].$project as Record<string, number>;
}

/** The `$map` that builds `lines`. */
function lineShape(stages: PipelineStage[]) {
  const stage = stages.find(
    (s) =>
      '$addFields' in s &&
      'lines' in (s.$addFields as object) &&
      '$cond' in (s.$addFields as { lines: object }).lines,
  ) as { $addFields: { lines: { $cond: unknown[] } } };
  const [, mapped, fallback] = stage.$addFields.lines.$cond as [
    unknown,
    { $map: { in: Record<string, unknown> } },
    Record<string, unknown>[],
  ];
  return { typed: mapped.$map.in, fallback: fallback[0] };
}

/**
 * PAC-152, part 2. `linesPrefix` is the one definition of a sale every
 * dashboard reads; the Analytics page's options must not move a byte of what
 * the Owner and Manager dashboards already get.
 */
describe('linesPrefix', () => {
  it('without options, emits exactly what it did before the options existed', () => {
    expect(linesPrefix(MATCH, SOLD_LINES, {}, false, {})).toEqual(
      linesPrefix(MATCH, SOLD_LINES, {}, false),
    );
    const stages = linesPrefix(MATCH, SOLD_LINES, {}, false);
    expect(lookupProjection(stages)).toEqual({
      _id: 0,
      policyType: 1,
      premium: 1,
      items: 1,
    });
    expect(lineShape(stages).typed).not.toHaveProperty('carrier');
    expect(lineShape(stages).fallback).not.toHaveProperty('carrier');
  });

  it('carries the carrier on every line when asked', () => {
    const stages = linesPrefix(MATCH, SOLD_LINES, {}, false, { carrier: true });
    expect(lookupProjection(stages)).toMatchObject({ carrier: 1 });
    expect(lineShape(stages).typed).toEqual(
      expect.objectContaining({
        carrier: { $ifNull: ['$$row.carrier', null] },
      }),
    );
    // A sale with no policy rows has no carrier to report.
    expect(lineShape(stages).fallback).toMatchObject({ carrier: null });
  });

  it('filters lines to the selected carriers, alias codes included, and drops emptied records', () => {
    const stages = linesPrefix(MATCH, SOLD_LINES, {}, false, {
      carriers: ['Allstate'],
    });
    expect(lookupProjection(stages)).toMatchObject({ carrier: 1 });
    const filterIndex = stages.findIndex((stage) =>
      JSON.stringify(stage).includes('"$$line.carrier"'),
    );
    expect(filterIndex).toBeGreaterThan(-1);
    expect(JSON.stringify(stages[filterIndex])).toContain('B4tEH');
    expect(stages[filterIndex + 1]).toEqual({
      $match: { 'lines.0': { $exists: true } },
    });
    // Totals are summed after the filter, so they are the carrier's share.
    const last = stages[stages.length - 1] as { $addFields: object };
    expect(Object.keys(last.$addFields)).toEqual(['linePremium', 'lineItems']);
  });

  it('gives quote lines a null carrier — recaps record none', () => {
    const stages = linesPrefix(MATCH, QUOTED_LINES, {}, false, {
      carrier: true,
    });
    expect(lineShape(stages).typed).toMatchObject({
      carrier: { $ifNull: ['$$row.carrier', null] },
    });
  });
});

describe('carrierValues', () => {
  it('is null with nothing selected', () => {
    expect(carrierValues(undefined)).toBeNull();
    expect(carrierValues([])).toBeNull();
  });

  it('expands each name to every stored spelling', () => {
    expect(carrierValues(['Allstate', 'Progressive'])).toEqual([
      'Allstate',
      'B4tEH',
      'Progressive',
    ]);
  });
});
