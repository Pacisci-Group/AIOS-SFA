import type { ConfigService } from '@nestjs/config';
import { readS3Settings } from './s3-client.factory';

/** A `ConfigService` over a plain object, with `get(key, default)` semantics. */
function configOf(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('readS3Settings', () => {
  /**
   * These are `StorageService`'s historical defaults. The factory was lifted
   * out of its constructor (PAC-172), and a changed default here would change
   * how every deployed environment reaches its uploads bucket.
   */
  it("keeps StorageService's defaults", () => {
    expect(readS3Settings(configOf({}), 'STORAGE')).toEqual({
      endpoint: undefined,
      region: 'us-east-1',
      accessKeyId: '',
      secretAccessKey: '',
      forcePathStyle: true,
    });
  });

  /**
   * The deploy renders an unset secret as `KEY=`, and `new S3Client` throws on
   * an empty region — which, in a constructor, is a worker that cannot boot.
   */
  it('treats an empty region as unset', () => {
    expect(
      readS3Settings(
        configOf({ DB_BACKUP_STORAGE_REGION: '' }),
        'DB_BACKUP_STORAGE',
      ).region,
    ).toBe('us-east-1');
  });

  it('treats an empty endpoint as unset', () => {
    expect(
      readS3Settings(configOf({ STORAGE_ENDPOINT: '' }), 'STORAGE').endpoint,
    ).toBeUndefined();
  });

  /** The snapshot bucket must never silently fall back to the uploads key. */
  it('reads only its own prefix', () => {
    const config = configOf({
      STORAGE_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
      STORAGE_ACCESS_KEY_ID: 'uploads-key',
      STORAGE_SECRET_ACCESS_KEY: 'uploads-secret',
      DB_BACKUP_STORAGE_REGION: 'sfo3',
      DB_BACKUP_STORAGE_FORCE_PATH_STYLE: 'false',
    });
    expect(readS3Settings(config, 'DB_BACKUP_STORAGE')).toEqual({
      endpoint: undefined,
      region: 'sfo3',
      accessKeyId: '',
      secretAccessKey: '',
      forcePathStyle: false,
    });
  });
});
