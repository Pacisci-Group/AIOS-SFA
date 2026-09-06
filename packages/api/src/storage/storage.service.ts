import { randomUUID } from 'crypto';
import type { Readable } from 'stream';
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
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
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

/**
 * A platform-owned object — one belonging to no tenant (PAC-71).
 *
 * A mailer campaign is run once and can serve many agencies, or all of them, so
 * its vendor file and its print output belong to *no* `agencyId` and cannot go
 * under the `agencies/<id>/` namespace {@link BuildObjectKeyInput} builds. They
 * get their own top-level `platform/` prefix instead, which
 * {@link StorageService.assertPlatformKeyOwnership} tests the same way.
 */
export interface BuildPlatformObjectKeyInput {
  /** Logical grouping, e.g. `mailer-campaigns`. Part of the ownership prefix. */
  purpose: string;
  filename: string;
  /**
   * Extra path segments between the year and the file, e.g. the campaign id and
   * the attempt number. Sanitized like the filename, so a caller cannot inject
   * `..` or escape the purpose prefix.
   */
  parts?: string[];
  /**
   * Whether to prefix the name with a UUID. Default `true`.
   *
   * Uploads must be unique — two files with the same name would otherwise
   * overwrite each other. A **generated** object wants the opposite: the commit
   * job's output CSV is keyed on `<campaignId>/<attempt>`, so a retried attempt
   * overwrites its own partial write instead of littering storage with
   * near-identical files nothing points at.
   */
  unique?: boolean;
}

/** What storage reports about an object that was actually uploaded. */
export interface StoredObjectStat {
  size: number;
  contentType: string | null;
}

/**
 * How a presigned GET should present the object to the browser (PAC-56 #30).
 *
 * Both fields are signed into the URL as S3 response-header overrides, so the
 * value the browser sees is fixed at signing time and cannot be tampered with
 * by whoever holds the link.
 */
export interface PresignedDownloadOptions {
  /**
   * `inline` hands the file to the browser's own PDF or image viewer;
   * `attachment` forces a download.
   *
   * Defaults to `inline` because that is what the Lead Detail file rows want,
   * and an attachment disposition defeats the native viewer entirely — the user
   * gets a file in their downloads folder instead of a document on screen. They
   * can still download from the viewer.
   */
  disposition?: 'inline' | 'attachment';
  /**
   * The name the browser shows/saves.
   *
   * Worth passing: object keys are UUID-prefixed and agency-namespaced, so
   * without it the user sees `a1b2…-quote.pdf` rather than `quote.pdf`.
   */
  filename?: string;
  /**
   * Overrides the stored `Content-Type`.
   *
   * Load-bearing for anything uploaded before the content type was recorded
   * correctly: a PDF served as `application/octet-stream` downloads instead of
   * rendering, whatever the disposition says.
   */
  contentType?: string;
  /**
   * Seconds the URL stays valid. Defaults to `STORAGE_DOWNLOAD_URL_TTL_SECONDS`
   * (5 minutes), which is right for a link minted when a user clicks.
   *
   * A link that travels — the mailer campaign's completion email carries one for
   * seven days (PAC-71) — needs its own, longer, value: the recipient may open
   * the mail tomorrow, and a dead link in an already-delivered email cannot be
   * refreshed. ⚠ The presigned URL *is* the capability, so a longer TTL is a
   * longer window in which a forwarded mail grants the file. Deliberate here,
   * never a default.
   */
  expiresIn?: number;
}

/**
 * Make a stored filename safe to interpolate into a `Content-Disposition`
 * header value.
 *
 * A raw `"` would terminate the quoted string and a newline would let the
 * filename inject a second header — both reachable from a user-supplied upload
 * name. Stripped rather than escaped: these characters have no business in a
 * document name, and a mangled display name is a better failure than a broken
 * header.
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[\r\n"\\]/g, '').slice(0, 200) || 'document';
}

/**
 * Reduce a name to one safe object-key path segment.
 *
 * Lower-cased, everything outside `[a-z0-9.\-_]` collapsed to a dash, capped.
 * That is what makes `..` and `/` unrepresentable, so a caller-supplied filename
 * or path part can never climb out of the prefix an ownership check relies on.
 */
function objectKeySegment(value: string, fallback: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9.\-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || fallback
  );
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
   * the API reaches MinIO at `minio:9000` but the browser uses `localhost:9000`).
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

    // Omitting credentials hands the SDK to its default provider chain (env
    // AWS_*, ~/.aws, instance role). That is legitimate for a role-based
    // deployment, but MinIO and DigitalOcean Spaces both need explicit keys —
    // and when the chain comes up empty the failure surfaces at *presign* time
    // as an opaque "Could not load credentials from any providers", far from
    // the actual cause. Say so at boot instead.
    if (endpoint && !(accessKeyId && secretAccessKey)) {
      this.logger.warn(
        'STORAGE_ENDPOINT is set but STORAGE_ACCESS_KEY_ID / ' +
          'STORAGE_SECRET_ACCESS_KEY are not — falling back to the AWS default ' +
          'credential chain. Set both unless this deployment uses an instance role.',
      );
    }

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
    const safeName = objectKeySegment(filename, '');
    const year = new Date().getUTCFullYear();
    return `agencies/${agencyId}/${purpose}/${year}/${randomUUID()}-${
      safeName || 'file'
    }`;
  }

  /**
   * The tenant-less counterpart of {@link buildObjectKey} (PAC-71).
   *
   * `platform/<purpose>/<year>/<parts…>/<uuid>-<name>`, or without the UUID when
   * `unique: false`. See {@link BuildPlatformObjectKeyInput} for why a mailer
   * campaign's files have no agency to be namespaced under.
   */
  buildPlatformObjectKey({
    purpose,
    filename,
    parts = [],
    unique = true,
  }: BuildPlatformObjectKeyInput): string {
    const year = new Date().getUTCFullYear();
    const segments = parts
      .map((part) => objectKeySegment(part, ''))
      .filter((part) => part.length > 0);
    const safeName = objectKeySegment(filename, 'file');
    const name = unique ? `${randomUUID()}-${safeName}` : safeName;
    return [`platform/${purpose}`, String(year), ...segments, name].join('/');
  }

  /**
   * The inverse of {@link buildPlatformObjectKey}.
   *
   * Same security property as {@link assertKeyOwnership}: a client hands back the
   * key it was given, so without an exact prefix test it could hand back any key
   * it knew of — including a *tenant's* document — and have the platform read it.
   * `objectKeySegment` is what makes the prefix unforgeable from the parts a
   * caller supplies.
   */
  assertPlatformKeyOwnership(key: string, { purpose }: { purpose: string }) {
    if (!key.startsWith(`platform/${purpose}/`)) {
      throw new BadRequestException('Invalid file key.');
    }
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
    this.assertConfigured();
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

  /**
   * Presigning is offline — it signs a URL and never calls the provider — so
   * without credentials it fails deep inside the AWS SDK's provider chain with
   * `CredentialsProviderError: Could not load credentials from any providers`,
   * a 500 that says nothing about the actual cause. `onModuleInit` already
   * warns when storage is unconfigured; this makes the request-time failure say
   * the same thing instead of surfacing an SDK stack trace to the user.
   */
  private assertConfigured(): void {
    if (this.configured) {
      return;
    }
    this.logger.error(
      'Object storage is not configured — set STORAGE_ENDPOINT and the ' +
        'STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY pair (see .env.example).',
    );
    throw new ServiceUnavailableException(
      'Document uploads are unavailable: object storage is not configured.',
    );
  }

  /**
   * Presigned GET URL for viewing a stored object.
   *
   * Defaults to an **inline** disposition — following the URL opens the file in
   * the browser's native viewer rather than downloading it. See
   * {@link PresignedDownloadOptions}.
   */
  async createPresignedDownload(
    key: string,
    options: PresignedDownloadOptions = {},
  ): Promise<string> {
    this.assertConfigured();
    const { disposition = 'inline', filename, contentType } = options;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: filename
        ? `${disposition}; filename="${sanitizeFilename(filename)}"`
        : disposition,
      ...(contentType ? { ResponseContentType: contentType } : {}),
    });
    return getSignedUrl(this.signingClient, command, {
      expiresIn: options.expiresIn ?? this.downloadExpiry,
    });
  }

  /**
   * Write bytes we generated ourselves (PAC-71).
   *
   * The counterpart to {@link createPresignedUpload}, which exists so a
   * *browser* never sends file bytes through the API. This is the opposite case
   * — the mailer campaign's print CSV is produced server-side inside a worker
   * job, so there is no browser to presign for and nothing would be gained by
   * signing a URL only to have the same process PUT to it.
   *
   * Uses the **internal** client, like {@link getObjectStream}: this is a
   * server-side write over the compose network.
   *
   * Buffered rather than streamed on purpose. The output is built in memory by
   * `writeVendorCsv` (the transform sorts and dedupes the whole file, so the
   * rows are already resident), and `PutObjectCommand` needs a known
   * `ContentLength` — handing it a stream means a multipart upload for no gain
   * at this size.
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string; size: number }> {
    this.assertConfigured();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    );
    return { key, size: body.byteLength };
  }

  /** Seconds a presigned download stays valid — echoed to clients. */
  get downloadUrlTtlSeconds(): number {
    return this.downloadExpiry;
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

  /**
   * The object's bytes as a stream, for server-side processing (PAC-73).
   *
   * The counterpart to {@link createPresignedDownload}: that one hands a URL to
   * a browser, this one hands the content to us. The mailer import needs it
   * because a 23 MB CSV must be parsed row by row rather than buffered — and
   * because the bytes went straight from the browser to storage, the API has
   * never seen them.
   *
   * Uses the **internal** client, not the signing one: this is a server-side
   * read over the compose network, not something a browser follows.
   *
   * @throws NotFoundException when the key holds nothing. A missing object at
   * this point means an upload that was presigned but never completed, which is
   * a real and reachable state rather than an internal error.
   */
  async getObjectStream(key: string): Promise<Readable> {
    this.assertConfigured();
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) {
        throw new NotFoundException('Uploaded file is empty or missing.');
      }
      // In Node the SDK returns a `Readable`; the union also covers the
      // browser's `ReadableStream`/`Blob`, neither of which occurs here.
      return res.Body as Readable;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.warn(
        `Could not read object "${key}": ${(err as Error).message}`,
      );
      throw new NotFoundException('Uploaded file could not be read.');
    }
  }
}
