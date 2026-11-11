import { activityRecordedAt } from './activity-recorded-at';

const soldDate = new Date('2026-10-30T05:00:00.000Z'); // agency-local midnight
const enteredAt = new Date('2026-11-03T15:12:00.000Z');

describe('activityRecordedAt', () => {
  it('uses the entry time, not the business date, on an app-written row', () => {
    expect(
      activityRecordedAt({
        source: 'internal',
        occurredAt: soldDate,
        createdAt: enteredAt,
      }),
    ).toBe(enteredAt);
  });

  it.each(['share_link', 'mailer', 'app'])(
    'treats a %s row as app-written',
    (source) => {
      expect(
        activityRecordedAt({
          source,
          occurredAt: soldDate,
          createdAt: enteredAt,
        }),
      ).toBe(enteredAt);
    },
  );

  it.each(['migration', 'demo'])(
    'keeps the business date on a %s row, whose createdAt is the import run',
    (source) => {
      expect(
        activityRecordedAt({
          source,
          occurredAt: soldDate,
          createdAt: enteredAt,
        }),
      ).toBe(soldDate);
    },
  );

  it('falls back to occurredAt when createdAt is missing', () => {
    expect(
      activityRecordedAt({ source: 'internal', occurredAt: soldDate }),
    ).toBe(soldDate);
  });

  it('is undefined when the row carries neither', () => {
    expect(activityRecordedAt({ source: 'internal' })).toBeUndefined();
  });
});
