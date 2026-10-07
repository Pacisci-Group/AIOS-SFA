import {
  assignUnique,
  isLocalUri,
  rewriteText,
  type ScrubOptions,
} from './scrub-emails';

const options = (overrides: Partial<ScrubOptions> = {}): ScrubOptions => ({
  domain: 'yopmail.com',
  dryRun: true,
  keep: new Set(),
  ...overrides,
});

describe('scrub-emails', () => {
  describe('rewriteText', () => {
    it('replaces the domain of a bare address', () => {
      expect(rewriteText('pat@example.com', options())).toBe('pat@yopmail.com');
    });

    it('replaces the domain inside a display-name address', () => {
      // `emailMessages.from` is stored as `Name <address>`.
      expect(
        rewriteText('Smith Family <noreply@smith.agency>', options()),
      ).toBe('Smith Family <noreply@yopmail.com>');
    });

    it('is idempotent: an address already on the target domain is unchanged', () => {
      const value = 'pat@yopmail.com';
      expect(rewriteText(value, options())).toBe(value);
    });

    it('leaves a kept address alone', () => {
      const value = 'asad@company.com';
      expect(
        rewriteText(value, options({ keep: new Set(['asad@company.com']) })),
      ).toBe(value);
    });

    it.each(['admin@sfa.local', 'pat@texasholdings.local', 'x@foo.test'])(
      'leaves the reserved-TLD seed login %s alone',
      (value) => {
        expect(rewriteText(value, options())).toBe(value);
      },
    );

    it('returns the same string when there is no address in it', () => {
      const value = 'not an email';
      expect(rewriteText(value, options())).toBe(value);
    });
  });

  describe('assignUnique', () => {
    it('suffixes colliding local parts, oldest row keeping the bare name', () => {
      const assigned = assignUnique(
        [
          { id: '000000000000000000000002', value: 'pat@yahoo.com' },
          { id: '000000000000000000000001', value: 'pat@gmail.com' },
          { id: '000000000000000000000003', value: 'Pat@outlook.com' },
        ],
        options(),
      );
      expect(assigned.get('000000000000000000000001')).toBe('pat@yopmail.com');
      expect(assigned.get('000000000000000000000002')).toBe(
        'pat-2@yopmail.com',
      );
      expect(assigned.get('000000000000000000000003')).toBe(
        'pat-3@yopmail.com',
      );
    });

    it('never lands a rewrite on an address that is already on the target domain', () => {
      const assigned = assignUnique(
        [
          { id: '000000000000000000000002', value: 'pat@gmail.com' },
          { id: '000000000000000000000001', value: 'pat@yopmail.com' },
        ],
        options(),
      );
      // The fixed point is not in the map (nothing to write)...
      expect(assigned.has('000000000000000000000001')).toBe(false);
      // ...and the rewrite steps around it.
      expect(assigned.get('000000000000000000000002')).toBe(
        'pat-2@yopmail.com',
      );
    });
  });

  describe('isLocalUri', () => {
    it.each([
      'mongodb://localhost:27017/sfa',
      'mongodb://127.0.0.1:27017/sfa?directConnection=true',
      'mongodb://root:pw@mongo:27017/sfa?authSource=admin',
      'mongodb://localhost:27017,127.0.0.1:27018/sfa?replicaSet=rs0',
    ])('accepts %s', (uri) => {
      expect(isLocalUri(uri)).toBe(true);
    });

    it.each([
      'mongodb://user:pw@db-prod-do-user-1.b.db.ondigitalocean.com:25060/sfa?tls=true',
      'mongodb+srv://user:pw@cluster0.example.mongodb.net/sfa',
      'mongodb://localhost:27017,db.example.com:27017/sfa',
      'mongodb://10.0.0.5:27017/sfa',
    ])('refuses %s', (uri) => {
      expect(isLocalUri(uri)).toBe(false);
    });
  });
});
