import type { ConfigService } from '@nestjs/config';
import { BackupStore } from './backup-store';

/** A `ConfigService` over a plain object, with `get(key, default)` semantics. */
function configOf(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

/** Exactly what the deploy renders for an environment with no backup secrets. */
const RENDERED_UNSET = {
  DB_BACKUP_ENABLED: 'false',
  DB_BACKUP_STORAGE_ENDPOINT: '',
  DB_BACKUP_STORAGE_REGION: '',
  DB_BACKUP_STORAGE_BUCKET: '',
  DB_BACKUP_STORAGE_ACCESS_KEY_ID: '',
  DB_BACKUP_STORAGE_SECRET_ACCESS_KEY: '',
  DB_BACKUP_STORAGE_FORCE_PATH_STYLE: 'false',
};

describe('BackupStore', () => {
  /**
   * The regression this pins took the worker down at boot: `new S3Client` with
   * an empty region throws, the store was constructed eagerly, and every
   * environment without backup secrets renders the region as `KEY=`.
   */
  it('constructs in an environment that never configured backups', () => {
    expect(() => new BackupStore(configOf(RENDERED_UNSET))).not.toThrow();
    expect(() => new BackupStore(configOf({}))).not.toThrow();
  });

  it('names every missing setting', () => {
    expect(new BackupStore(configOf(RENDERED_UNSET)).missingSettings()).toEqual(
      [
        'DB_BACKUP_STORAGE_ENDPOINT',
        'DB_BACKUP_STORAGE_BUCKET',
        'DB_BACKUP_STORAGE_ACCESS_KEY_ID',
        'DB_BACKUP_STORAGE_SECRET_ACCESS_KEY',
      ],
    );
  });

  it('reports nothing missing when configured', () => {
    const store = new BackupStore(
      configOf({
        DB_BACKUP_STORAGE_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
        DB_BACKUP_STORAGE_REGION: '',
        DB_BACKUP_STORAGE_BUCKET: 'sfa-dev-db-backups',
        DB_BACKUP_STORAGE_ACCESS_KEY_ID: 'key',
        DB_BACKUP_STORAGE_SECRET_ACCESS_KEY: 'secret',
      }),
    );
    expect(store.missingSettings()).toEqual([]);
    expect(store.bucketName).toBe('sfa-dev-db-backups');
  });
});
