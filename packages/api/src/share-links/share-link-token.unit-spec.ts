import {
  generateShareLinkToken,
  isWellFormedShareLinkToken,
  SHARE_LINK_TOKEN_LENGTH,
} from './share-link-token';

describe('share link tokens', () => {
  it('generates 43 URL-safe characters', () => {
    const token = generateShareLinkToken();
    expect(token).toHaveLength(SHARE_LINK_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is URL-safe — no padding or characters needing encoding', () => {
    for (let i = 0; i < 200; i++) {
      const token = generateShareLinkToken();
      expect(token).not.toContain('=');
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(encodeURIComponent(token)).toBe(token);
    }
  });

  it('does not repeat across many draws', () => {
    const draws = new Set(
      Array.from({ length: 1000 }, () => generateShareLinkToken()),
    );
    expect(draws.size).toBe(1000);
  });

  describe('isWellFormedShareLinkToken', () => {
    it('accepts a generated token', () => {
      expect(isWellFormedShareLinkToken(generateShareLinkToken())).toBe(true);
    });

    it('rejects wrong lengths and illegal characters', () => {
      expect(isWellFormedShareLinkToken('')).toBe(false);
      expect(isWellFormedShareLinkToken('a'.repeat(42))).toBe(false);
      expect(isWellFormedShareLinkToken('a'.repeat(44))).toBe(false);
      expect(isWellFormedShareLinkToken(`${'a'.repeat(42)}/`)).toBe(false);
      expect(isWellFormedShareLinkToken(`${'a'.repeat(42)}$`)).toBe(false);
    });

    it('rejects traversal and injection shapes outright', () => {
      expect(isWellFormedShareLinkToken('../../etc/passwd')).toBe(false);
      expect(isWellFormedShareLinkToken('{"$ne":null}')).toBe(false);
    });
  });
});
