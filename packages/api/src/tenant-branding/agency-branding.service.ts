import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import {
  StorageService,
  type PresignedUpload,
} from '../storage/storage.service';
import {
  BRANDING_IMAGE_TYPES,
  BRANDING_MAX_BYTES,
  type BrandingSlot,
  type BrandingUploadDto,
  type UpdateBrandingDto,
} from './dto/branding.dto';

/** The `purpose` segment every branding object key carries. */
const BRANDING_PURPOSE = 'branding';

/** Which branding field each upload slot commits to. */
const SLOT_FIELD: Record<
  BrandingSlot,
  'logoKey' | 'logoDarkKey' | 'faviconKey'
> = {
  logo: 'logoKey',
  logoDark: 'logoDarkKey',
  favicon: 'faviconKey',
};

/**
 * The agency-owner write path for branding.
 *
 * Split from `TenantBrandingService` (the read path) because the two have
 * opposite audiences and opposite risk profiles: the reader is public and must
 * never throw, the writer is permission-gated and must validate hard.
 */
@Injectable()
export class AgencyBrandingService {
  constructor(
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    private readonly storage: StorageService,
  ) {}

  /** Current values, for the settings form. */
  async get(agencyId: string) {
    const agency = await this.loadAgency(agencyId);
    const branding = agency.branding ?? {};
    return {
      agencyName: agency.name,
      displayName: branding.displayName ?? null,
      tagline: branding.tagline ?? null,
      hasLogo: !!branding.logoKey,
      hasLogoDark: !!branding.logoDarkKey,
      hasFavicon: !!branding.faviconKey,
    };
  }

  /**
   * Presign a direct-to-storage PUT for one branding image.
   *
   * Same two-step shape as document uploads: the browser sends the bytes
   * straight to storage, then calls {@link update} with the returned key. The
   * API never handles the file, which is what keeps a 2 MB upload off the
   * request pipeline.
   */
  async presignUpload(
    agencyId: string,
    dto: BrandingUploadDto,
  ): Promise<PresignedUpload & { slot: BrandingSlot }> {
    // Belt and braces — the zod enum already rejects anything else, but this is
    // the check that matters if the schema is ever loosened, and the reason is
    // written down in `BRANDING_IMAGE_TYPES`.
    if (!BRANDING_IMAGE_TYPES.includes(dto.contentType)) {
      throw new BadRequestException('Use a PNG, JPEG or WebP image.');
    }

    const key = this.storage.buildObjectKey({
      agencyId,
      purpose: BRANDING_PURPOSE,
      filename: dto.filename,
    });

    const upload = await this.storage.createPresignedUpload(
      key,
      dto.contentType,
    );
    return { ...upload, slot: dto.slot };
  }

  /**
   * Apply text edits and commit uploaded keys.
   *
   * A key is only stored after the object behind it has been **inspected**:
   * `assertKeyOwnership` proves the key belongs to this agency, and `statObject`
   * proves something was actually uploaded and is the size and type we allow. A
   * presigned PUT signs only the content type, so the size cap has no other
   * enforcement point — validating the client's claim would validate nothing.
   */
  async update(agencyId: string, dto: UpdateBrandingDto) {
    const agency = await this.loadAgency(agencyId);
    agency.branding ??= {};

    if (dto.displayName !== undefined) {
      agency.branding.displayName = dto.displayName ?? undefined;
    }
    if (dto.tagline !== undefined) {
      agency.branding.tagline = dto.tagline ?? undefined;
    }

    for (const [slot, field] of Object.entries(SLOT_FIELD) as [
      BrandingSlot,
      (typeof SLOT_FIELD)[BrandingSlot],
    ][]) {
      const incoming = dto[field];
      if (incoming === undefined) continue;

      if (incoming === null) {
        agency.branding[field] = undefined;
        continue;
      }

      await this.assertUploadedImage(agencyId, incoming, slot);
      agency.branding[field] = incoming;
    }

    // The sub-document is a plain object on a `Object`-typed parent path in
    // enough places that Mongoose's change tracking cannot be relied on here —
    // the same `markModified` the module-entitlement writer needs.
    agency.markModified('branding');
    await agency.save();

    return this.get(agencyId);
  }

  private async assertUploadedImage(
    agencyId: string,
    key: string,
    slot: BrandingSlot,
  ): Promise<void> {
    // Without this, a client could hand back any key it knew of — including
    // another agency's object — and have it rendered under its own brand.
    this.storage.assertKeyOwnership(key, {
      agencyId,
      purpose: BRANDING_PURPOSE,
    });

    const stat = await this.storage.statObject(key);
    if (!stat) {
      throw new BadRequestException(
        `The ${slot} upload did not complete. Try uploading it again.`,
      );
    }

    if (stat.size > BRANDING_MAX_BYTES) {
      throw new BadRequestException(
        `That image is ${Math.ceil(stat.size / 1024 / 1024)} MB. Keep it under ${
          BRANDING_MAX_BYTES / 1024 / 1024
        } MB.`,
      );
    }

    if (
      !stat.contentType ||
      !BRANDING_IMAGE_TYPES.includes(
        stat.contentType as (typeof BRANDING_IMAGE_TYPES)[number],
      )
    ) {
      // The stored type, not the claimed one. This is the check that stops an
      // SVG arriving through a PUT that was presigned as a PNG.
      throw new BadRequestException('Use a PNG, JPEG or WebP image.');
    }
  }

  private async loadAgency(agencyId: string): Promise<AgencyDocument> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agency = await this.agencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }
    return agency;
  }
}
