import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { dbBackupEnabled } from '../../config/db-backup.config';
import {
  type S3ClientSettings,
  createS3Client,
  readS3Settings,
} from '../../storage/s3-client.factory';

/**
 * The snapshot bucket (PAC-172): `sfa-<env>-db-backups`, reached with its own
 * bucket-scoped key from `DB_BACKUP_STORAGE_*`.
 *
 * ## Why not `StorageService`
 * That service is the uploads bucket, and is deliberately single-bucket: its
 * key is scoped to the uploads and nothing else, so it could not write here if
 * we asked it to. The two share how a client is built (`s3-client.factory.ts`)
 * and nothing more.
 *
 * ## ⚠ No fallback to `STORAGE_*`, and no bucket creation
 * A missing `DB_BACKUP_STORAGE_*` value fails the snapshot loudly instead of
 * borrowing the uploads settings — a fallback would quietly put every tenant's
 * data, in one file, in the bucket the app hands presigned URLs out of.
 * Terraform owns the bucket, and the worker's key could not create one anyway.
 *
 * ## The client is built on first use, never at construction
 * This provider is constructed in every worker — and in the API wherever it
 * serves the functions inline — including every environment that never turned
 * backups on. Nothing about an optional feature's settings may be able to stop
 * that process from booting, so the constructor only reads them.
 */
@Injectable()
export class BackupStore {
  private readonly logger = new Logger(BackupStore.name);
  private readonly settings: S3ClientSettings;
  private client: S3Client | null = null;
  private readonly bucket: string;
  private readonly missing: string[];

  constructor(config: ConfigService) {
    const settings = readS3Settings(config, 'DB_BACKUP_STORAGE');
    this.settings = settings;
    this.bucket = config.get<string>('DB_BACKUP_STORAGE_BUCKET', '');
    this.missing = [
      ...(settings.endpoint ? [] : ['DB_BACKUP_STORAGE_ENDPOINT']),
      ...(this.bucket ? [] : ['DB_BACKUP_STORAGE_BUCKET']),
      ...(settings.accessKeyId ? [] : ['DB_BACKUP_STORAGE_ACCESS_KEY_ID']),
      ...(settings.secretAccessKey
        ? []
        : ['DB_BACKUP_STORAGE_SECRET_ACCESS_KEY']),
    ];
    if (
      this.missing.length > 0 &&
      dbBackupEnabled(config.get<string>('DB_BACKUP_ENABLED'))
    ) {
      this.logger.warn(
        `DB_BACKUP_ENABLED is true but ${this.missing.join(', ')} ` +
          `${this.missing.length === 1 ? 'is' : 'are'} not set — every snapshot will fail.`,
      );
    }
  }

  /**
   * With bounded requests: a snapshot's upload runs inside a step, and an
   * upload that hung with no timeout would hold that dump's in-flight entry —
   * and so every later snapshot in this worker — until the process restarted.
   * Idle-bounded, so a slow upload that is still sending bytes is left alone.
   */
  private s3(): S3Client {
    this.client ??= createS3Client(this.settings, undefined, {
      connectionTimeout: 30_000,
      socketTimeout: 5 * 60_000,
    });
    return this.client;
  }

  get bucketName(): string {
    return this.bucket;
  }

  /** The `DB_BACKUP_STORAGE_*` variables still unset; empty when configured. */
  missingSettings(): string[] {
    return [...this.missing];
  }

  /**
   * Upload a file in one PUT — atomic, so a reader (or a retried upload to the
   * same key) never sees half an archive. `ContentLength` from the file is
   * what lets a plain `PutObjectCommand` take a stream; see
   * `StorageService.putObjectFromFile`, which this mirrors. A single PUT tops
   * out at 5 GiB, which the caller checks for.
   */
  async putFile(
    key: string,
    path: string,
    contentType: string,
  ): Promise<{ key: string; size: number }> {
    const { size } = await stat(path);
    await this.s3().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(path),
        ContentType: contentType,
        ContentLength: size,
      }),
    );
    return { key, size };
  }

  /** Every key under `prefix`, following continuation tokens. */
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.s3().send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) keys.push(object.Key);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  /**
   * One object at a time, on purpose: rotation deletes a handful at most, and
   * single deletes sidestep the batch API's `Content-MD5` requirement, which
   * S3-compatible stores do not all agree on.
   */
  async deleteObject(key: string): Promise<void> {
    await this.s3().send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
