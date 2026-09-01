import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Response } from 'express';
import { Model } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import {
  StorageService,
  type PresignedUpload,
} from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AVATAR_IMAGE_TYPES,
  AVATAR_MAX_BYTES,
  type AvatarUploadDto,
  type CommitAvatarDto,
  type UpdateMyProfileDto,
} from './dto/profile.dto';

/**
 * The self-service write path for a user's own profile (PAC-81).
 *
 * Everything here is scoped to the caller's own document — no permission gate,
 * no cross-user reads. Both mutations return the same auth-user blob as
 * `GET /auth/me`, so the client can overwrite its stored copy in one step and
 * the sidebar never disagrees with the profile page.
 */
@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly storage: StorageService,
    private readonly authService: AuthService,
  ) {}

  async updateProfile(userId: string, dto: UpdateMyProfileDto) {
    const user = await this.loadUser(userId);

    if (dto.firstName !== undefined) {
      user.firstName = dto.firstName ?? undefined;
    }
    if (dto.lastName !== undefined) {
      user.lastName = dto.lastName ?? undefined;
    }
    await user.save();

    return this.authService.me(userId);
  }

  /**
   * Presign a direct-to-storage PUT for a profile photo. Same two-step shape
   * as the branding logo: the browser sends the bytes straight to storage,
   * then calls {@link commitAvatar} with the returned key.
   */
  async presignAvatarUpload(
    userId: string,
    dto: AvatarUploadDto,
  ): Promise<PresignedUpload> {
    const user = await this.loadUser(userId);

    const key = this.storage.buildObjectKey({
      agencyId: this.storageScope(user),
      purpose: this.avatarPurpose(userId),
      filename: dto.filename,
    });

    return this.storage.createPresignedUpload(key, dto.contentType);
  }

  /**
   * Commit an uploaded photo (`key`) or remove the current one (`key: null`).
   *
   * A key is only stored after the object behind it has been inspected —
   * `assertKeyOwnership` proves this user's presign produced it, and
   * `statObject` proves what actually landed is a raster image within the size
   * cap. A presigned PUT signs only the content type, so the stored stat is
   * the sole server-side evidence (see `AgencyBrandingService.update`).
   */
  async commitAvatar(userId: string, dto: CommitAvatarDto) {
    const user = await this.loadUser(userId);

    if (dto.key === undefined) {
      throw new BadRequestException('Nothing to update.');
    }

    if (dto.key === null) {
      user.avatarKey = undefined;
    } else {
      await this.assertUploadedImage(user, dto.key);
      user.avatarKey = dto.key;
    }
    await user.save();

    return this.authService.me(userId);
  }

  /**
   * The photo's bytes, streamed from object storage. Mirrors
   * `TenantBootstrapController.stream` except the cache is `private` — this is
   * an authenticated response about a person, not a public logo.
   */
  async streamAvatar(userId: string, res: Response): Promise<void> {
    const user = await this.loadUser(userId);
    if (!user.avatarKey) {
      throw new NotFoundException();
    }

    const stat = await this.storage.statObject(user.avatarKey);
    const stream = await this.storage.getObjectStream(user.avatarKey);

    // The stored content type, never a guess from the key's extension — the
    // extension comes from the uploaded filename and the stored type was
    // validated on commit.
    res.setHeader(
      'Content-Type',
      stat?.contentType ?? 'application/octet-stream',
    );
    if (stat?.size) {
      res.setHeader('Content-Length', stat.size);
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    stream.pipe(res);
  }

  /**
   * Photo keys are namespaced per *user*, not just per agency, so the
   * ownership prefix check is exact: one producer can never commit a
   * colleague's upload. Platform admins have no agency and get a `platform`
   * scope segment instead.
   */
  private storageScope(user: UserDocument): string {
    return user.agencyId?.toString() ?? 'platform';
  }

  private avatarPurpose(userId: string): string {
    return `avatars/${userId}`;
  }

  private async assertUploadedImage(
    user: UserDocument,
    key: string,
  ): Promise<void> {
    this.storage.assertKeyOwnership(key, {
      agencyId: this.storageScope(user),
      purpose: this.avatarPurpose(user._id.toString()),
    });

    const stat = await this.storage.statObject(key);
    if (!stat) {
      throw new BadRequestException(
        'The photo upload did not complete. Try uploading it again.',
      );
    }
    if (stat.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException(
        `That image is ${Math.ceil(stat.size / 1024 / 1024)} MB. Keep it under ${
          AVATAR_MAX_BYTES / 1024 / 1024
        } MB.`,
      );
    }
    if (
      !stat.contentType ||
      !AVATAR_IMAGE_TYPES.includes(
        stat.contentType as (typeof AVATAR_IMAGE_TYPES)[number],
      )
    ) {
      // The stored type, not the claimed one — this is the check that stops an
      // SVG arriving through a PUT that was presigned as a PNG.
      throw new BadRequestException('Use a PNG, JPEG or WebP image.');
    }
  }

  private async loadUser(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    // Mirrors `AuthService.me` — a missing or inactive user holding a live
    // token is a session that should already be dead.
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }
}
