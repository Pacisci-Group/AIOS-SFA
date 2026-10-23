import { S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';

/**
 * How to reach one S3-compatible bucket, read from a family of env vars.
 *
 * `STORAGE_*` is the uploads bucket (`StorageService`); `DB_BACKUP_STORAGE_*`
 * is the snapshot bucket (PAC-172), reached with its own bucket-scoped key.
 */
export interface S3ClientSettings {
  /** Unset means "not configured" — callers decide what that disables. */
  endpoint: string | undefined;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export type S3SettingsPrefix = 'STORAGE' | 'DB_BACKUP_STORAGE';

/**
 * Read `<prefix>_ENDPOINT`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`
 * and `_FORCE_PATH_STYLE`.
 *
 * The defaults are `StorageService`'s: region `us-east-1`, no credentials (the
 * AWS default chain), and path-style addressing on — MinIO requires it, while
 * Spaces and most cloud providers use virtual-host, so every deployed
 * environment sets it to `false`.
 *
 * ## ⚠ An empty region is an unset region
 * The deploy renders every variable it knows about, set or not, so a secret an
 * environment never defined arrives as `KEY=` — an empty string, which
 * `ConfigService.get(key, default)` returns as-is. `new S3Client({ region: '' })`
 * throws "Region is missing" **synchronously**, and the clients are built in
 * constructors, so an empty `DB_BACKUP_STORAGE_REGION` in an environment that
 * never enabled backups would crash the worker at boot (PAC-172 review).
 */
export function readS3Settings(
  config: ConfigService,
  prefix: S3SettingsPrefix,
): S3ClientSettings {
  return {
    endpoint: config.get<string>(`${prefix}_ENDPOINT`) || undefined,
    region: config.get<string>(`${prefix}_REGION`) || 'us-east-1',
    accessKeyId: config.get<string>(`${prefix}_ACCESS_KEY_ID`, ''),
    secretAccessKey: config.get<string>(`${prefix}_SECRET_ACCESS_KEY`, ''),
    forcePathStyle:
      config.get<string>(`${prefix}_FORCE_PATH_STYLE`, 'true') === 'true',
  };
}

/**
 * Build the client.
 *
 * The one place an `S3Client` is constructed, so the uploads client and the
 * snapshot client cannot drift on how credentials and addressing are applied —
 * a second, hand-rolled client is what `eslint.config.mjs` calls "strictly
 * worse". `endpointOverride` is for `StorageService`'s signing client, which
 * signs browser-facing URLs against `STORAGE_PUBLIC_URL`.
 *
 * Omitting both keys hands the SDK to its default credential chain; whether
 * that is acceptable is the caller's call (see `StorageService`).
 */
export function createS3Client(
  settings: S3ClientSettings,
  endpointOverride?: string,
): S3Client {
  const endpoint = endpointOverride ?? settings.endpoint;
  const credentials =
    settings.accessKeyId && settings.secretAccessKey
      ? {
          credentials: {
            accessKeyId: settings.accessKeyId,
            secretAccessKey: settings.secretAccessKey,
          },
        }
      : {};
  return new S3Client({
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    ...(endpoint ? { endpoint } : {}),
    ...credentials,
  });
}
