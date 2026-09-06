import { Body, Controller, Get, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { JwtPayload } from '@sfa/shared';
import {
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { CurrentUser } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  avatarUploadSchema,
  commitAvatarSchema,
  updateMyProfileSchema,
  type AvatarUploadDto,
  type CommitAvatarDto,
  type UpdateMyProfileDto,
} from './dto/profile.dto';
import { ProfileService } from './profile.service';

/**
 * The caller's own profile (PAC-81).
 *
 * Authenticated but otherwise ungated, exactly like `GET /auth/me`:
 * `@SkipTenant`/`@SkipBranch` because a platform admin has no agency or
 * branch and editing your own name must work for them too, `@SkipModule` and
 * no permission because "my profile" is not a product module an agency can
 * switch off or a capability an owner grants. Identity comes from the token's
 * `sub` alone — no route here accepts a user id.
 */
@Controller('me')
@SkipTenant()
@SkipBranch()
@SkipModule()
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** Edit own name. Returns the same auth-user blob as `GET /auth/me`. */
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(updateMyProfileSchema))
    body: UpdateMyProfileDto,
  ) {
    return this.profileService.updateProfile(user.sub, body);
  }

  /** Presign a direct-to-storage PUT for a profile photo. */
  @Post('avatar/uploads')
  presignAvatarUpload(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(avatarUploadSchema))
    body: AvatarUploadDto,
  ) {
    return this.profileService.presignAvatarUpload(user.sub, body);
  }

  /**
   * Commit an uploaded photo key, or remove the photo (`key: null`). Returns
   * the auth-user blob, whose `avatarUrl` reflects the change.
   */
  @Patch('avatar')
  commitAvatar(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(commitAvatarSchema))
    body: CommitAvatarDto,
  ) {
    return this.profileService.commitAvatar(user.sub, body);
  }

  /** The caller's own photo bytes. `404` when none is set. */
  @Get('avatar')
  streamAvatar(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    return this.profileService.streamAvatar(user.sub, res);
  }
}
