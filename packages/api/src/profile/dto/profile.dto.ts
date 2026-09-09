import { z } from 'zod';
import { clearable, trimmedText } from '../../common/dto/clearable';

/**
 * Image types a user may upload as a profile photo.
 *
 * **SVG is deliberately absent**, for the same reason it is absent from
 * `BRANDING_IMAGE_TYPES`: an SVG is executable markup, and these bytes are
 * served from our own origin to a page holding a session — a user-supplied SVG
 * would be a stored-XSS primitive. Raster formats have no such capability.
 */
export const AVATAR_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** Generous for a headshot, small enough that nobody is using us as a CDN. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const updateMyProfileSchema = z.object({
  firstName: clearable(trimmedText(60)),
  lastName: clearable(trimmedText(60)),
});
export type UpdateMyProfileDto = z.infer<typeof updateMyProfileSchema>;

export const avatarUploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(AVATAR_IMAGE_TYPES),
});
export type AvatarUploadDto = z.infer<typeof avatarUploadSchema>;

/**
 * Commit an uploaded photo, or remove the current one. `key` is `clearable`
 * for the same reason the branding keys are: removing a photo must stay
 * distinguishable from not sending the field at all.
 */
export const commitAvatarSchema = z.object({
  key: clearable(trimmedText(500)),
});
export type CommitAvatarDto = z.infer<typeof commitAvatarSchema>;
