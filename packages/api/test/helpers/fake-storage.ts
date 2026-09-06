import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { StorageService } from '../../src/storage/storage.service';

/**
 * Object storage, in a `Map` (PAC-71).
 *
 * The mailer campaign suites read and write real files, so they need storage to
 * *work* rather than to be absent — and standing MinIO up for them would make
 * the suite fail on any machine or CI job that has not started it, for no
 * coverage: what these tests are about is the transform, the import and the
 * gate, none of which care whose bytes they are.
 *
 * The key-shaping and ownership rules are reimplemented rather than stubbed,
 * because `assertPlatformKeyOwnership` is a **security** check — a client hands
 * back the key it was given — and a fake that waved it through would let a test
 * pass against a service that had stopped enforcing it.
 */
export class FakeStorage {
  readonly objects = new Map<
    string,
    { body: Buffer; contentType: string | null }
  >();
  /** Keys handed out by `createPresignedUpload`, for assertions. */
  readonly presigned: string[] = [];

  buildObjectKey({
    agencyId,
    purpose,
    filename,
  }: {
    agencyId: string;
    purpose: string;
    filename: string;
  }): string {
    return `agencies/${agencyId}/${purpose}/${randomUUID()}-${safe(filename)}`;
  }

  assertKeyOwnership(
    key: string,
    { agencyId, purpose }: { agencyId: string; purpose: string },
  ): void {
    if (!key.startsWith(`agencies/${agencyId}/${purpose}/`)) {
      throw new BadRequestException('Invalid document key.');
    }
  }

  buildPlatformObjectKey({
    purpose,
    filename,
    parts = [],
    unique = true,
  }: {
    purpose: string;
    filename: string;
    parts?: string[];
    unique?: boolean;
  }): string {
    const name = unique ? `${randomUUID()}-${safe(filename)}` : safe(filename);
    return [
      `platform/${purpose}`,
      String(new Date().getUTCFullYear()),
      ...parts.map((part) => safe(part)).filter(Boolean),
      name,
    ].join('/');
  }

  assertPlatformKeyOwnership(key: string, { purpose }: { purpose: string }) {
    if (!key.startsWith(`platform/${purpose}/`)) {
      throw new BadRequestException('Invalid file key.');
    }
  }

  createPresignedUpload(key: string, contentType: string) {
    this.presigned.push(key);
    return Promise.resolve({
      key,
      uploadUrl: `https://storage.test/${key}`,
      requiredHeaders: { 'Content-Type': contentType },
      expiresIn: 300,
    });
  }

  createPresignedDownload(key: string): Promise<string> {
    return Promise.resolve(`https://storage.test/${key}?signed=1`);
  }

  get downloadUrlTtlSeconds(): number {
    return 300;
  }

  putObject(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
    return Promise.resolve({ key, size: body.byteLength });
  }

  statObject(key: string) {
    const object = this.objects.get(key);
    return Promise.resolve(
      object
        ? { size: object.body.byteLength, contentType: object.contentType }
        : null,
    );
  }

  objectExists(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  getObjectStream(key: string): Promise<Readable> {
    const object = this.objects.get(key);
    if (!object) {
      return Promise.reject(
        new NotFoundException('Uploaded file could not be read.'),
      );
    }
    // ⚠ `objectMode: false`. `Readable.from(buffer)` defaults to object mode,
    // which delivers the whole archive as one chunk and changes how the XLSX
    // reader's zip parser is driven. Real object storage hands over a byte
    // stream, and a fake that behaves differently is a fake that hides bugs.
    return Promise.resolve(Readable.from(object.body, { objectMode: false }));
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** The provider value, typed as the real service for the DI override. */
  asService(): StorageService {
    return this as unknown as StorageService;
  }
}

function safe(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9.\-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'file'
  );
}
