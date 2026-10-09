import { zonedDayStart } from '../../../performance/performance.range';
import type { DateFieldDef } from './dataset.types';
import { dateWindowStages, LEAD_CREATED_YMD_FIELD } from './date-window';

const field = (kind: DateFieldDef['kind'], path = 'f'): DateFieldDef => ({
  key: 'k',
  label: 'K',
  path,
  kind,
});

describe('dateWindowStages', () => {
  it('adds nothing when neither end is given', () => {
    expect(dateWindowStages(field('ymd'), undefined, undefined, 'UTC')).toEqual(
      [],
    );
  });

  it('cuts a ymd field half-open, with `to` inclusive', () => {
    expect(
      dateWindowStages(
        field('ymd', 'soldDateYmd'),
        '2026-01-01',
        '2026-01-31',
        'UTC',
      ),
    ).toEqual([{ $match: { soldDateYmd: { $gte: 20260101, $lt: 20260201 } } }]);
  });

  it('leaves an open end open', () => {
    expect(
      dateWindowStages(field('ymd'), '2026-01-01', undefined, 'UTC'),
    ).toEqual([{ $match: { f: { $gte: 20260101 } } }]);
    expect(
      dateWindowStages(field('ymd'), undefined, '2024-02-28', 'UTC'),
    ).toEqual([
      // Leap year: the day after Feb 28 is Feb 29.
      { $match: { f: { $lt: 20240229 } } },
    ]);
  });

  it('cuts an instant at the start of each day in the agency zone', () => {
    const [stage] = dateWindowStages(
      field('instant', 'createdAt'),
      '2026-03-01',
      '2026-03-01',
      'Asia/Kolkata',
    );
    expect(stage).toEqual({
      $match: {
        createdAt: {
          $gte: zonedDayStart({ year: 2026, month: 3, day: 1 }, 'Asia/Kolkata'),
          $lt: zonedDayStart({ year: 2026, month: 3, day: 2 }, 'Asia/Kolkata'),
        },
      },
    });
    // Kolkata starts its day at 18:30 UTC the evening before.
    expect(
      (
        stage as { $match: { createdAt: { $gte: Date } } }
      ).$match.createdAt.$gte.toISOString(),
    ).toBe('2026-02-28T18:30:00.000Z');
  });

  it('cuts a stored calendar date on UTC midnights', () => {
    expect(
      dateWindowStages(
        field('utcDate', 'effectiveDate'),
        '2026-01-01',
        '2026-12-31',
        'America/Chicago',
      ),
    ).toEqual([
      {
        $match: {
          effectiveDate: {
            $gte: new Date('2026-01-01T00:00:00.000Z'),
            $lt: new Date('2027-01-01T00:00:00.000Z'),
          },
        },
      },
    ]);
  });

  it('buckets leads by the dashboards’ created-day rule before windowing', () => {
    const stages = dateWindowStages(
      field('leadCreated'),
      '2026-05-01',
      '2026-05-31',
      'America/Chicago',
    );
    expect(stages).toHaveLength(2);
    expect(
      Object.keys((stages[0] as { $addFields: object }).$addFields),
    ).toEqual([LEAD_CREATED_YMD_FIELD]);
    expect(stages[1]).toEqual({
      $match: { [LEAD_CREATED_YMD_FIELD]: { $gte: 20260501, $lt: 20260601 } },
    });
  });
});
