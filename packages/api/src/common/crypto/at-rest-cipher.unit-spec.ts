import { randomBytes } from 'crypto';
import {
  decryptSecret,
  encryptSecret,
  readEncryptionKey,
  secretEquals,
} from './at-rest-cipher';

/**
 * A valid key, in the form the environment variable carries it.
 *
 * Generated per run rather than hard-coded: a fixed base64 key in a test file
 * is the kind of string that gets copied into a `.env` when someone is in a
 * hurry, and this one would then be protecting real private keys.
 */
function freshKeyB64(): string {
  return randomBytes(32).toString('base64');
}

describe('readEncryptionKey', () => {
  it('accepts a 32-byte base64 key', () => {
    const key = readEncryptionKey(freshKeyB64());
    expect(key).toHaveLength(32);
  });

  /**
   * The whole point of throwing. A missing key must never fall back to storing
   * plaintext — that would write unencrypted private keys into a collection
   * whose only defence is that they are encrypted, and nothing downstream would
   * notice.
   */
  it('refuses an unset key rather than degrading', () => {
    expect(() => readEncryptionKey(undefined)).toThrow(/not set/i);
    expect(() => readEncryptionKey('')).toThrow(/not set/i);
  });

  it('refuses a key of the wrong length', () => {
    // 16 bytes — valid base64, wrong size for AES-256. Silently accepting this
    // would mean `createCipheriv` throwing much later, on a code path that only
    // runs when a certificate is being issued.
    expect(() => readEncryptionKey(randomBytes(16).toString('base64'))).toThrow(
      /32 bytes/,
    );
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a PEM private key', () => {
    const key = readEncryptionKey(freshKeyB64());
    const pem =
      '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----\n';

    expect(decryptSecret(encryptSecret(pem, key), key)).toBe(pem);
  });

  it('round-trips multi-byte characters', () => {
    const key = readEncryptionKey(freshKeyB64());
    const value = 'clé privée — 秘密鍵';

    expect(decryptSecret(encryptSecret(value, key), key)).toBe(value);
  });

  /**
   * A fresh IV per call is what stops the key/IV pair repeating, which is the
   * one thing GCM must never do. Equal ciphertexts for equal plaintexts would
   * mean the IV had been fixed.
   */
  it('produces a different ciphertext each time', () => {
    const key = readEncryptionKey(freshKeyB64());
    const a = encryptSecret('same input', key);
    const b = encryptSecret('same input', key);

    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe(decryptSecret(b, key));
  });

  it('emits a versioned envelope', () => {
    const key = readEncryptionKey(freshKeyB64());
    const parts = encryptSecret('x', key).split('.');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  /**
   * The reason for an *authenticated* cipher. Unauthenticated, a flipped bit
   * would decrypt to plausible garbage that gets handed to
   * `tls.createSecureContext` as a private key.
   */
  it('rejects a tampered ciphertext', () => {
    const key = readEncryptionKey(freshKeyB64());
    const envelope = encryptSecret('private key material', key);

    const [version, iv, tag, ciphertext] = envelope.split('.');
    const flipped = Buffer.from(ciphertext, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [version, iv, tag, flipped.toString('base64')].join('.');

    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('rejects a ciphertext encrypted under a different key', () => {
    const envelope = encryptSecret('x', readEncryptionKey(freshKeyB64()));

    expect(() =>
      decryptSecret(envelope, readEncryptionKey(freshKeyB64())),
    ).toThrow();
  });

  it('rejects a malformed envelope', () => {
    const key = readEncryptionKey(freshKeyB64());

    expect(() => decryptSecret('not-an-envelope', key)).toThrow(/Malformed/);
    expect(() => decryptSecret('v1.a.b', key)).toThrow(/4 dot-separated/);
  });

  /**
   * Dispatching on the version marker is what allows a future scheme to be
   * introduced without migrating every row at once, so an unknown one has to
   * fail loudly rather than being ignored.
   */
  it('rejects an unknown envelope version', () => {
    const key = readEncryptionKey(freshKeyB64());
    const envelope = encryptSecret('x', key).replace(/^v1\./, 'v2.');

    expect(() => decryptSecret(envelope, key)).toThrow(/version 'v2'/);
  });
});

describe('secretEquals', () => {
  it('matches identical values', () => {
    expect(secretEquals('token.thumbprint', 'token.thumbprint')).toBe(true);
  });

  it('rejects different values of the same length', () => {
    expect(secretEquals('aaaa', 'aaab')).toBe(false);
  });

  /**
   * `timingSafeEqual` throws on a length mismatch. Returning false is the
   * behaviour callers need — an ACME responder handed a short token should
   * answer "no", not crash the request.
   */
  it('rejects different lengths without throwing', () => {
    expect(secretEquals('short', 'much longer value')).toBe(false);
  });
});
