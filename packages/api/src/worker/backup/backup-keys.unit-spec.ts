import {
  SCHEDULED_PREFIX,
  buildArchiveKey,
  compactUtc,
  isScheduledArchiveKey,
  safeLabel,
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
