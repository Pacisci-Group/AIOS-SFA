import {
  SCHEDULED_PREFIX,
  buildArchiveKey,
  compactUtc,
  isScheduledArchiveKey,
  safeLabel,
  scheduleWeekOf,
  scheduleWeekStart,
  scheduledArchiveTime,
  selectKeysToDelete,
} from './backup-keys';

const AT = new Date('2026-10-25T08:00:12.345Z');

/** A scheduled key for the given ISO instant. */
const weekly = (iso: string) => buildArchiveKey('scheduled', new Date(iso));

describe('compactUtc', () => {
  it('is basic-format UTC to the second', () => {
    expect(compactUtc(AT)).toBe('20261025T080012Z');
  });

  /** The property rotation relies on. */
  it('sorts chronologically as a plain string', () => {
    const instants = [
      '2026-12-27T08:00:00Z',
      '2026-01-04T08:00:00Z',
      '2027-01-03T08:00:00Z',
      '2026-10-25T08:00:00Z',
    ].map((iso) => new Date(iso));
    const byString = instants.map(compactUtc).sort();
    const byTime = [...instants]
      .sort((a, b) => a.getTime() - b.getTime())
      .map(compactUtc);
    expect(byString).toEqual(byTime);
  });
});

describe('buildArchiveKey', () => {
  it('puts scheduled archives under weekly/ with no label', () => {
    expect(buildArchiveKey('scheduled', AT, 'ignored')).toBe(
      'weekly/20261025T080012Z.archive.gz',
    );
  });

  it('puts requested snapshots under their reason, with the label', () => {
    expect(buildArchiveKey('manual', AT, 'Before PAC-180!')).toBe(
      'manual/20261025T080012Z-before-pac-180.archive.gz',
    );
    expect(buildArchiveKey('pre-deploy', AT, '3f9c2ab')).toBe(
      'pre-deploy/20261025T080012Z-3f9c2ab.archive.gz',
    );
  });

  it('omits the separator when there is no usable label', () => {
    expect(buildArchiveKey('manual', AT)).toBe(
      'manual/20261025T080012Z.archive.gz',
    );
    expect(buildArchiveKey('manual', AT, '!!!')).toBe(
      'manual/20261025T080012Z.archive.gz',
    );
  });
});

describe('safeLabel', () => {
  /** A label must never be able to leave its prefix — least of all into weekly/. */
  it('cannot express a path', () => {
    expect(safeLabel('../weekly/x')).toBe('..-weekly-x');
    expect(safeLabel('a/b')).toBe('a-b');
  });

  it('caps the length without leaving a trailing dash', () => {
    const label = safeLabel(`${'a'.repeat(39)} b`);
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label.endsWith('-')).toBe(false);
  });

  it('treats null and undefined as empty', () => {
    expect(safeLabel(null)).toBe('');
    expect(safeLabel(undefined)).toBe('');
  });
});

describe('isScheduledArchiveKey', () => {
  it('matches only a scheduled archive name', () => {
    expect(isScheduledArchiveKey(weekly('2026-10-25T08:00:00Z'))).toBe(true);
    expect(isScheduledArchiveKey(`${SCHEDULED_PREFIX}README.txt`)).toBe(false);
    expect(isScheduledArchiveKey('weekly/2026.archive.gz')).toBe(false);
    expect(isScheduledArchiveKey('weekly/20261025T080000Z-x.archive.gz')).toBe(
      false,
    );
    expect(isScheduledArchiveKey('manual/20261025T080000Z.archive.gz')).toBe(
      false,
    );
    expect(
      isScheduledArchiveKey('weekly/sub/20261025T080000Z.archive.gz'),
    ).toBe(false);
  });
});

describe('selectKeysToDelete', () => {
  const w1 = weekly('2026-09-27T08:00:00Z');
  const w2 = weekly('2026-10-04T08:00:00Z');
  const w3 = weekly('2026-10-11T08:00:00Z');
  const w4 = weekly('2026-10-18T08:00:00Z');
  const w5 = weekly('2026-10-25T08:00:00Z');

  it('keeps the newest four of five, deleting the oldest', () => {
    expect(
      selectKeysToDelete([w1, w2, w3, w4, w5], 4, { protect: w5 }),
    ).toEqual([w1]);
  });

  it('does not depend on the order of the listing', () => {
    expect(
      selectKeysToDelete([w3, w5, w1, w4, w2], 4, { protect: w5 }),
    ).toEqual([w1]);
  });

  it('deletes nothing until there are more than keep', () => {
    expect(selectKeysToDelete([w3, w4, w5], 4, { protect: w5 })).toEqual([]);
    expect(selectKeysToDelete([], 4)).toEqual([]);
  });

  it('with keep 1, keeps only the archive just written', () => {
    expect(
      selectKeysToDelete([w1, w2, w3, w4, w5], 1, { protect: w5 }).sort(),
    ).toEqual([w1, w2, w3, w4]);
  });

  /**
   * A skewed clock could stamp the new archive older than an existing one. It
   * must still survive, and still count toward keep.
   */
  it('never deletes the protected key, even when it sorts oldest', () => {
    const doomed = selectKeysToDelete([w1, w2, w3, w4, w5], 4, { protect: w1 });
    expect(doomed).not.toContain(w1);
    expect(doomed).toEqual([w2]);
  });

  it('never returns anything that is not a scheduled archive', () => {
    const keys = [
      w1,
      w2,
      w3,
      w4,
      w5,
      'weekly/README.txt',
      'weekly/20260101T000000Z-copy.archive.gz',
      'manual/20250101T000000Z.archive.gz',
    ];
    expect(selectKeysToDelete(keys, 1, { protect: w5 }).sort()).toEqual([
      w1,
      w2,
      w3,
      w4,
    ]);
  });

  it('keeps keep when the protected key is absent from the listing', () => {
    expect(selectKeysToDelete([w1, w2, w3, w4, w5], 4)).toEqual([w1]);
  });
});

describe('scheduledArchiveTime', () => {
  it('reads the instant back from a scheduled key', () => {
    expect(scheduledArchiveTime('weekly/20261025T080012Z.archive.gz')).toBe(
      Date.parse('2026-10-25T08:00:12Z'),
    );
  });

  it('is null for anything that is not a scheduled archive', () => {
    expect(scheduledArchiveTime('weekly/README.txt')).toBeNull();
    expect(
      scheduledArchiveTime('manual/20261025T080012Z.archive.gz'),
    ).toBeNull();
  });
});

describe('selectKeysToDelete — one archive per week', () => {
  const sunday = (iso: string) => weekly(`${iso}T08:00:00Z`);
  const w2 = sunday('2026-10-04');
  const w3 = sunday('2026-10-11');
  const w4 = sunday('2026-10-18');
  const w5 = sunday('2026-10-25');

  /**
   * A dashboard Rerun of Sunday's run writes a second archive for the same
   * week. It must replace that week's earlier archive, not push out W-3 — the
   * oldest restore point and the only one past DigitalOcean's 7-day window.
   */
  it("replaces the same week's earlier archive on a re-run", () => {
    const rerun = weekly('2026-10-25T10:30:00Z');
    expect(
      selectKeysToDelete([w2, w3, w4, w5, rerun], 4, { protect: rerun }),
    ).toEqual([w5]);
  });

  it('treats a re-run days later in the week the same way', () => {
    const thursday = weekly('2026-10-29T09:00:00Z');
    expect(
      selectKeysToDelete([w2, w3, w4, w5, thursday], 4, { protect: thursday }),
    ).toEqual([w5]);
  });

  it('counts a missed week as a gap, not a duplicate', () => {
    const fortnightLater = sunday('2026-11-08');
    expect(
      selectKeysToDelete([w2, w3, w4, w5, fortnightLater], 4, {
        protect: fortnightLater,
      }),
    ).toEqual([w2]);
  });

  /**
   * The case a distance rule gets wrong: a re-run late in the week is still
   * that week's only archive when the next Sunday runs, so it must survive it.
   */
  it('keeps a late-week re-run when the next Sunday rotates', () => {
    const w1 = sunday('2026-09-27');
    // The Oct 25 cron failed; the operator re-ran it on Tuesday.
    const tuesday = weekly('2026-10-27T10:00:00Z');
    expect(
      selectKeysToDelete([w1, w2, w3, w4, tuesday], 4, { protect: tuesday }),
    ).toEqual([w1]);
    const nov1 = sunday('2026-11-01');
    expect(
      selectKeysToDelete([w2, w3, w4, tuesday, nov1], 4, { protect: nov1 }),
    ).toEqual([w2]);
  });

  it('treats a Wednesday re-run of a good Sunday as that week', () => {
    const wednesday = weekly('2026-10-28T12:00:00Z');
    expect(
      selectKeysToDelete([w2, w3, w4, w5, wednesday], 4, {
        protect: wednesday,
      }),
    ).toEqual([w5]);
    const nov1 = sunday('2026-11-01');
    expect(
      selectKeysToDelete([w2, w3, w4, wednesday, nov1], 4, { protect: nov1 }),
    ).toEqual([w2]);
  });
});

describe('scheduleWeekOf', () => {
  /** Weeks run Sunday 00:00 to Sunday 00:00 Pakistan time (UTC+5). */
  it('turns over at Saturday 19:00 UTC', () => {
    const lastSecond = Date.parse('2026-10-31T18:59:59Z');
    const firstSecond = Date.parse('2026-10-31T19:00:00Z');
    expect(scheduleWeekOf(firstSecond)).toBe(scheduleWeekOf(lastSecond) + 1);
    expect(scheduleWeekStart(lastSecond)).toBe(
      Date.parse('2026-10-24T19:00:00Z'),
    );
  });

  it('puts the cron well inside its week', () => {
    const cron = Date.parse('2026-10-25T08:00:00Z');
    expect(cron - scheduleWeekStart(cron)).toBe(13 * 60 * 60_000);
  });

  it('is exactly one week per seven days, in both directions', () => {
    const t = Date.parse('2026-10-25T08:00:00Z');
    const week = 7 * 24 * 60 * 60_000;
    expect(scheduleWeekOf(t + week)).toBe(scheduleWeekOf(t) + 1);
    expect(scheduleWeekOf(t - 52 * week)).toBe(scheduleWeekOf(t) - 52);
    expect(scheduleWeekOf(Date.parse('2020-01-01T00:00:00Z'))).toBeLessThan(0);
  });
});
