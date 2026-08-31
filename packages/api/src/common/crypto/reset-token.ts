import { createHash, randomBytes } from 'crypto';

/**
 * Password-reset token handling (PAC-79).
 *
 * Two callers, deliberately sharing one file: `UsersService` mints and stores
 * the digest, `AuthService` hashes an incoming token to look the user up. If
 * they ever computed the digest differently, every reset link would 404 and the
 * only symptom would be "the emails don't work".
 */

/** A 32-byte token, hex-encoded. The only copy of this belongs in the email. */
export function mintResetToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * What actually goes in the database.
 *
 * Unsalted SHA-256 rather than bcrypt on purpose. This is not a password: it is
 * 256 bits of uniform randomness, so there is no dictionary to attack and no
 * work factor worth paying — and the lookup has to be a single indexed equality
 * query, which a per-row salt would make impossible.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
