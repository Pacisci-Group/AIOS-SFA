import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/**
 * Authenticated encryption for secrets that have to live in MongoDB.
 *
 * ## Why this exists
 * TLS private keys are stored in the `certificates` collection, because that is
 * what lets any node serve any hostname without a shared filesystem — the whole
 * basis of the autoscaling design. The cost of that choice is that a database
 * dump, a backup file, or a read-only analytics user would otherwise hand
 * someone every tenant's private key. Encrypting at the application layer means
 * the key material is only ever plaintext inside a process that holds
 * `CERT_ENCRYPTION_KEY`, which lives in the deploy environment and never in the
 * database.
 *
 * DigitalOcean encrypts Managed MongoDB volumes at rest already. That protects
 * against someone walking off with a disk; it does nothing about anything that
 * can issue a `find()`. These are different threats and the volume-level one is
 * not the interesting half.
 *
 * ## Why AES-256-GCM specifically
 * Authenticated: decryption fails loudly on a tampered or truncated ciphertext
 * rather than returning plausible garbage that would then be handed to
 * `tls.createSecureContext` as a private key. The 96-bit IV is the size GCM is
 * specified for, and a fresh random one per encryption is what keeps the
 * key/IV pair from ever repeating.
 *
 * ## Why not a KMS
 * A managed KMS would be better — the key would never be in process memory and
 * rotation would be someone else's problem. DigitalOcean does not offer one, and
 * reaching for another cloud's KMS to hold a key for a DigitalOcean deployment
 * buys a cross-provider dependency on the certificate path. This is the version
 * that fits the platform we are on; the envelope format below is versioned so
 * moving later does not require a migration of every row at once.
 */

/** Bytes of key material AES-256 requires. */
const KEY_BYTES = 32;

/** GCM's specified nonce size. Not a number to tune. */
const IV_BYTES = 12;

/**
 * Envelope format marker.
 *
 * On the front of every ciphertext so that a future scheme can be introduced
 * without a big-bang migration: `decrypt` dispatches on it, and rows can be
 * re-encrypted lazily as they are next written.
 */
const VERSION = 'v1';

const SEPARATOR = '.';

/**
 * Reads and validates the encryption key.
 *
 * Deliberately throws rather than falling back to storing plaintext. Every
 * silent-degradation trap this codebase has hit — storage disabling itself,
 * mail falling back to a logging transport — had the same shape: the system
 * came up healthy and did the wrong thing quietly. A missing key here would mean
 * writing unencrypted private keys into a collection whose whole point is that
 * they are encrypted, and nothing downstream would ever notice.
 */
export function readEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new Error(
      'CERT_ENCRYPTION_KEY is not set. It is required wherever certificates are ' +
        'read or written — generate one with `openssl rand -base64 32`.',
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CERT_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        'Generate one with `openssl rand -base64 32`.',
    );
  }
  return key;
}

/**
 * Encrypt a UTF-8 secret into a self-describing string.
 *
 * Output is `v1.<iv>.<authTag>.<ciphertext>`, each part base64. One opaque
 * string rather than a sub-document because it makes the field impossible to
 * half-write: there is no way to persist the ciphertext and lose the IV.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(SEPARATOR);
}

/**
 * Reverse {@link encryptSecret}.
 *
 * Throws on any malformed envelope, unknown version, or failed authentication.
 * Callers should let it throw: a private key that will not decrypt is not a
 * degraded state to work around, it is a certificate that cannot be served, and
 * the renewal path should treat it as a reason to re-issue rather than a reason
 * to serve something wrong.
 */
export function decryptSecret(envelope: string, key: Buffer): string {
  const parts = envelope.split(SEPARATOR);
  if (parts.length !== 4) {
    throw new Error(
      `Malformed encrypted value: expected 4 dot-separated parts, got ${parts.length}.`,
    );
  }

  const [version, ivB64, tagB64, ciphertextB64] = parts;
  if (version !== VERSION) {
    throw new Error(`Unsupported encryption envelope version '${version}'.`);
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES) {
    throw new Error(`Malformed encrypted value: IV is ${iv.length} bytes.`);
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  // `final()` is what verifies the tag, so this throws on tampering.
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Constant-time comparison for ACME key authorizations.
 *
 * Lives here rather than in the challenge handler because it is the same class
 * of concern: the value being compared is a secret an attacker can guess at, and
 * `===` on strings leaks how much of a guess was right through timing. Cheap
 * enough to be unconditional.
 */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
  // exactly one bit — unavoidable, and not worth padding around.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
