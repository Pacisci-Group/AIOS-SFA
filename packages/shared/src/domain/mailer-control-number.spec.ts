import {
  mailerControlNumberKey,
  mailerControlNumberKeys,
} from './mailer-control-number';

// The two forms as they really appear: `controlno` is '#' + a UUID, and
// `New Control Number` is that UUID's last 12 hex characters.
const CONTROL_NO = '#3f2a91c7-4d5e-4b8a-9f10-9c41b2d70e58';
const NEW_CONTROL_NO = '9c41b2d70e58';

describe('mailerControlNumberKey', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(mailerControlNumberKey(CONTROL_NO)).toBe(
      '3F2A91C74D5E4B8A9F109C41B2D70E58',
    );
    expect(mailerControlNumberKey(NEW_CONTROL_NO)).toBe('9C41B2D70E58');
  });

  it('is whitespace-tolerant and case-insensitive', () => {
    expect(mailerControlNumberKey('  9c41b2d70e58 ')).toBe('9C41B2D70E58');
    expect(mailerControlNumberKey('9C41-B2D7-0E58')).toBe('9C41B2D70E58');
  });

  it('returns undefined when there is nothing left after normalizing', () => {
    expect(mailerControlNumberKey('')).toBeUndefined();
    expect(mailerControlNumberKey('  ')).toBeUndefined();
    expect(mailerControlNumberKey('#')).toBeUndefined();
    expect(mailerControlNumberKey(null)).toBeUndefined();
  });
});

describe('mailerControlNumberKeys', () => {
  it('keeps both forms, long one first', () => {
    const keys = mailerControlNumberKeys(CONTROL_NO, NEW_CONTROL_NO);
    expect(keys).toEqual(['3F2A91C74D5E4B8A9F109C41B2D70E58', '9C41B2D70E58']);
  });

  it('deduplicates', () => {
    // A repeated value inside one document is a self-collision on the unique
    // multikey index.
    expect(mailerControlNumberKeys(NEW_CONTROL_NO, NEW_CONTROL_NO)).toEqual([
      '9C41B2D70E58',
    ]);
  });

  it('tolerates either side being absent', () => {
    expect(mailerControlNumberKeys(CONTROL_NO, '')).toHaveLength(1);
    expect(mailerControlNumberKeys('', NEW_CONTROL_NO)).toEqual([
      '9C41B2D70E58',
    ]);
    expect(mailerControlNumberKeys('', '')).toEqual([]);
  });
});
