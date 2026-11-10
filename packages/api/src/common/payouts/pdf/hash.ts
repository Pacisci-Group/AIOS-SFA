import { createHash } from 'crypto';

/**
 * SHA-256 of an issued statement's bytes, hex. Stored with the file and
 * shown on the statement, so the copy someone signs (PAC-182) can name the
 * exact file it acknowledges.
 */
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
