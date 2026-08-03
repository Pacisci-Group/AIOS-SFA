import { randomUUID } from 'crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PresignedUpload {
  /** Object key stored on the record. */
  key: string;
  /** Short-lived URL the browser PUTs the file bytes to. */
  uploadUrl: string;
  /** Header the browser must send on the PUT (must match the signed value). */
  requiredHeaders: Record<string, string>;
  /** Seconds until the URL expires. */
  expiresIn: number;
}

export interface BuildObjectKeyInput {
  agencyId: string;
  /** Logical grouping, e.g. `deal-audits`. */
  purpose: string;
  filename: string;
}

/** What storage reports about an object that was actually uploaded. */
export interface StoredObjectStat {
  size: number;
  contentType: string | null;
}

/**
 * Reusable S3-compatible object storage wrapper. Backed by MinIO locally and
 * DigitalOcean Spaces (or any S3-compatible provider) in the cloud — the client
 * is configured entirely from `STORAGE_*` env vars.
 *
 * Uploads use presigned PUT URLs so file bytes never pass through the API.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  /** Client used for server-side operations (bucket/head), internal endpoint. */
  private readonly client: S3Client;
  /**
   * Client used to sign browser-facing URLs. Same as {@link client} unless
   * `STORAGE_PUBLIC_URL` differs from the internal endpoint (e.g. Docker, where
   * the API reaches MinIO at `minio:9000` but the browser uses `localhost:9100`).
   */
  private readonly signingClient: S3Client;
  private readonly bucket: string;
  private readonly uploadExpiry: number;
  private readonly downloadExpiry: number;
  /** Whether a storage endpoint is configured (skip network ops if not). */
  private readonly configured: boolean;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT');
    this.configured = Boolean(endpoint);
    const publicEndpoint = this.config.get<string>('STORAGE_PUBLIC_URL');
    const region = this.config.get<string>('STORAGE_REGION', 'us-east-1');
    const accessKeyId = this.config.get<string>('STORAGE_ACCESS_KEY_ID', '');
    const secretAccessKey = this.config.get<string>(
      'STORAGE_SECRET_ACCESS_KEY',
      '',
    );
    // MinIO requires path-style addressing; most cloud providers use virtual-host.
    const forcePathStyle =
      this.config.get<string>('STORAGE_FORCE_PATH_STYLE', 'true') === 'true';

    this.bucket = this.config.get<string>('STORAGE_BUCKET', 'sfa-uploads');
    this.uploadExpiry = Number(
      this.config.get<string>('STORAGE_UPLOAD_URL_TTL_SECONDS', '300'),
    );
    this.downloadExpiry = Number(
      this.config.get<string>('STORAGE_DOWNLOAD_URL_TTL_SECONDS', '300'),
    );

    const credentials =
      accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {};

    this.client = new S3Client({
      region,
      forcePathStyle,
      ...(endpoint ? { endpoint } : {}),
      ...credentials,
    });

    // Sign against the public endpoint when provided so URLs are reachable by
    // the browser; otherwise reuse the same client.
    this.signingClient =
      publicEndpoint && publicEndpoint !== endpoint
        ? new S3Client({
            region,
            forcePathStyle,
            endpoint: publicEndpoint,
            ...credentials,
          })
        : this.client;
  }

  /**
   * Best-effort bucket bootstrap for local dev (MinIO starts empty). Never throws
   * — in production the bucket/credentials are expected to already exist.
   */
  async onModuleInit(): Promise<void> {
    if (!this.configured) {
      this.logger.warn(
        'STORAGE_ENDPOINT is not set — object storage is disabled. Document uploads will not work.',
      );
      return;
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Created storage bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.warn(
          `Storage bucket "${this.bucket}" is not reachable/creatable: ${
            (err as Error).message
          }. Uploads will fail until it exists.`,
        );
      }
    }
  }

  /**
   * Build a stable, agency-namespaced object key. The filename is sanitized and
   * prefixed with a UUID so uploads never collide or leak the raw name.
   */
  buildObjectKey({ agencyId, purpose, filename }: BuildObjectKeyInput): string {
    const safeName = filename
      .toLowerCase()
      .replace(/[^a-z0-9.\-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
    const year = new Date().getUTCFullYear();
    return `agencies/${agencyId}/${purpose}/${year}/${randomUUID()}-${
      safeName || 'file'
    }`;
  }

  /**
   * The inverse of {@link buildObjectKey}: reject a key this agency and purpose
   * did not produce.
   *
   * A client hands back the key it was given, so without this check it could
   * hand back *any* key it knew of — including another agency's object — and
   * have it attached to its own record. `buildObjectKey` puts `agencyId` and
   * `purpose` in fixed leading segments, so a prefix test is exact.
   *
   * Pass the same `purpose` string that was used to mint the key.
   */
  assertKeyOwnership(
    key: string,
    { agencyId, purpose }: Omit<BuildObjectKeyInput, 'filename'>,
  ): void {
    if (!key.startsWith(`agencies/${agencyId}/${purpose}/`)) {
      throw new BadRequestException('Invalid document key.');
    }
  }

  /** Presigned PUT URL the browser uploads directly to. */
  async createPresignedUpload(
    key: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.signingClient, command, {
      expiresIn: this.uploadExpiry,
    });
    return {
      key,
      uploadUrl,
      requiredHeaders: { 'Content-Type': contentType },
      expiresIn: this.uploadExpiry,
    };
  }

  /** Presigned GET URL for viewing/downloading a stored object. */
  async createPresignedDownload(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.signingClient, command, {
      expiresIn: this.downloadExpiry,
    });
  }

  /**
   * What actually landed in storage, or `null` if nothing did.
   *
   * A presigned PUT signs only `ContentType`, so a caller holding a valid URL
   * can upload a file of any size. Validating a `size` field in a JSON body
   * validates the client's claim, not the object — `HeadObject` is the only
   * server-side evidence of what was really stored.
   */
  async statObject(key: string): Promise<StoredObjectStat | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? null,
      };
    } catch {
      return null;
    }
  }

  /** Whether an object exists (used to confirm an upload completed). */
  async objectExists(key: string): Promise<boolean> {
    return (await this.statObject(key)) !== null;
  }
}
