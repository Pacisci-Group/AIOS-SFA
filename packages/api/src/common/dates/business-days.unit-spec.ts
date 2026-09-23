import { CalendarDate, toYmd } from '../../performance/performance.range';
import {
  addBusinessDays,
  agingCutoff,
  businessDaysBetween,
  isBusinessDay,
  usFederalHolidays,
} from './business-days';

const d = (iso: string): CalendarDate => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
};

const iso = (date: CalendarDate) =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

describe('usFederalHolidays', () => {
  it('lists the eleven 2026 holidays on their observed days', () => {
    expect(usFederalHolidays(2026).map(iso)).toEqual([
      '2026-01-01',
      '2026-01-19', // MLK — third Monday
      '2026-02-16', // Presidents' Day — third Monday
      '2026-05-25', // Memorial Day — last Monday
      '2026-06-19',
      '2026-07-03', // Independence Day falls on a Saturday → Friday
      '2026-09-07', // Labor Day — first Monday
      '2026-10-12', // Columbus Day — second Monday
      '2026-11-11',
      '2026-11-26', // Thanksgiving — fourth Thursday
      '2026-12-25',
    ]);
  });

  it('observes a Sunday holiday on the Monday after', () => {
    // 4 July 2027 is a Sunday.
    expect(usFederalHolidays(2027).map(iso)).toContain('2027-07-05');
    expect(usFederalHolidays(2027).map(iso)).not.toContain('2027-07-04');
  });

  it("files next year's New Year observed on 31 December under this year", () => {
    // 1 January 2028 is a Saturday, observed Friday 31 December 2027.
    expect(usFederalHolidays(2027).map(iso)).toContain('2027-12-31');
    expect(usFederalHolidays(2028).map(iso)).not.toContain('2027-12-31');
    expect(usFederalHolidays(2028).map(iso)).not.toContain('2028-01-01');
  });
});

describe('isBusinessDay', () => {
  it.each([
    ['a Wednesday', '2026-09-23', true],
    ['a Saturday', '2026-09-26', false],
    ['a Sunday', '2026-09-27', false],
    ['Labor Day', '2026-09-07', false],
    ['the observed Independence Day', '2026-07-03', false],
    ['the actual Independence Day (a Saturday anyway)', '2026-07-04', false],
    ['New Year observed on 31 Dec 2027', '2027-12-31', false],
  ])('%s → %s', (_name, date, expected) => {
    expect(isBusinessDay(d(date))).toBe(expected);
  });
});

describe('addBusinessDays', () => {
  it('skips the weekend', () => {
    // Friday + 1 business day = Monday.
    expect(iso(addBusinessDays(d('2026-09-25'), 1))).toBe('2026-09-28');
  });

  it('skips a holiday and the weekend around it', () => {
    // Friday 4 Sep 2026 + 1 → Tuesday 8 Sep (Labor Day is Monday 7 Sep).
    expect(iso(addBusinessDays(d('2026-09-04'), 1))).toBe('2026-09-08');
  });

  it('walks backwards', () => {
    // Tuesday 8 Sep − 1 → Friday 4 Sep.
    expect(iso(addBusinessDays(d('2026-09-08'), -1))).toBe('2026-09-04');
  });
});

describe('businessDaysBetween', () => {
  it('is zero for the same day or a reversed window', () => {
    expect(businessDaysBetween(d('2026-09-23'), d('2026-09-23'))).toBe(0);
    expect(businessDaysBetween(d('2026-09-24'), d('2026-09-23'))).toBe(0);
  });

  it('counts Friday → Monday as one elapsed business day', () => {
    expect(businessDaysBetween(d('2026-09-25'), d('2026-09-28'))).toBe(1);
  });

  it('does not count the start day but does count the end day', () => {
    // Mon 21 → Fri 25: Tue, Wed, Thu, Fri.
    expect(businessDaysBetween(d('2026-09-21'), d('2026-09-25'))).toBe(4);
  });

  it('skips Thanksgiving', () => {
    // Mon 23 Nov → Mon 30 Nov 2026: Tue, Wed, (Thu holiday), Fri, Mon = 4.
    expect(businessDaysBetween(d('2026-11-23'), d('2026-11-30'))).toBe(4);
  });
});

describe('agingCutoff', () => {
  const SLA = 5;

  it('on a Monday: sold last Monday is not aging, the Friday before is', () => {
    const cutoff = agingCutoff(d('2026-09-28'), SLA);
    expect(iso(cutoff)).toBe('2026-09-21');
    // Not aging — exactly five business days have passed.
    expect(toYmd(d('2026-09-21')) < toYmd(cutoff)).toBe(false);
    // Aging — six.
    expect(toYmd(d('2026-09-18')) < toYmd(cutoff)).toBe(true);
    // A weekend sale counts like the Friday before it.
    expect(toYmd(d('2026-09-19')) < toYmd(cutoff)).toBe(true);
  });

  it('on a Saturday: the previous Friday has had zero elapsed days', () => {
    // Sat 26 Sep: the window (Fri 18, Sat 26] holds Mon–Fri = 5, so Fri 18
    // is the cutoff and still not aging.
    const cutoff = agingCutoff(d('2026-09-26'), SLA);
    expect(iso(cutoff)).toBe('2026-09-18');
  });

  it('stretches across Thanksgiving week', () => {
    // Tue 1 Dec 2026: Mon 30, Fri 27, (Thu 26 holiday), Wed 25, Tue 24,
    // Mon 23 = 5 elapsed → cutoff Mon 23 Nov.
    expect(iso(agingCutoff(d('2026-12-01'), SLA))).toBe('2026-11-23');
  });

  it('agrees with businessDaysBetween on every day of a quarter', () => {
    const today = d('2026-12-15');
    const cutoff = toYmd(agingCutoff(today, SLA));
    for (let back = 0; back < 90; back += 1) {
      const sold = addBusinessDaysFree(today, -back);
      const viaCount = businessDaysBetween(sold, today) > SLA;
      const viaCutoff = toYmd(sold) < cutoff;
      expect({ sold: iso(sold), viaCutoff }).toEqual({
        sold: iso(sold),
        viaCutoff: viaCount,
      });
    }
  });
});

/** Plain calendar stepping, so the sweep above covers weekends and holidays. */
function addBusinessDaysFree(date: CalendarDate, delta: number): CalendarDate {
  const anchor = new Date(Date.UTC(date.year, date.month - 1, date.day));
  anchor.setUTCDate(anchor.getUTCDate() + delta);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}
