import { randomBytes } from 'crypto';

/**
 * 32 bytes — 256 bits of entropy, rendered as 43 URL-safe characters.
 *
 * Sized so the token space cannot be walked: this is the *only* credential
 * guarding a public write endpoint, and it appears in a URL that gets pasted
 * into emails and text messages.
 */
const TOKEN_BYTES = 32;

/** Length of the base64url encoding of {@link TOKEN_BYTES}. */
export const SHARE_LINK_TOKEN_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Opaque, non-enumerable share-link token. */
export function generateShareLinkToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Cheap shape check before touching the database.
 *
 * Purely a guard against pointless queries and log noise from junk URLs — it is
 * NOT a security control, and a well-formed token still has to exist and be
 * active. Callers must return the same generic failure for a malformed token as
 * for an unknown one, or the difference becomes an oracle.
 */
export function isWellFormedShareLinkToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
