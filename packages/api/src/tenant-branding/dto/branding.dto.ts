import { z } from 'zod';
import { clearable, trimmedText } from '../../common/dto/clearable';

/**
 * Image types an agency may upload as a logo or favicon.
 *
 * **SVG is deliberately absent.** An SVG is executable markup — it can carry
 * `<script>` and external references — and we serve these bytes from our own
 * origin, under the agency's own hostname, on a page that holds a session. A
 * tenant-supplied SVG is therefore a stored-XSS primitive against that tenant's
 * own users. Raster formats have no such capability.
 *
 * If SVG is ever wanted, the honest options are to sanitise it server-side or
 * to serve it from a separate origin with a `sandbox` CSP — not to add it here.
 */
export const BRANDING_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** Generous for a logo, small enough that nobody is using us as a CDN. */
export const BRANDING_MAX_BYTES = 2 * 1024 * 1024;

/** Which slot an upload is destined for. */
export const BRANDING_SLOTS = ['logo', 'logoDark', 'favicon'] as const;
export type BrandingSlot = (typeof BRANDING_SLOTS)[number];

export const brandingUploadSchema = z.object({
  slot: z.enum(BRANDING_SLOTS),
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(BRANDING_IMAGE_TYPES),
});
export type BrandingUploadDto = z.infer<typeof brandingUploadSchema>;

/**
 * Commit an upload, or edit the text fields.
 *
 * Every field is `clearable`: an owner removing their logo has to be able to
 * say so, and an absent key must stay distinguishable from "set this to
 * nothing" — otherwise the only way to drop a logo is to upload another one.
 * See `common/dto/clearable.ts` for the convention.
 */
export const updateBrandingSchema = z.object({
  displayName: clearable(trimmedText(60)),
  tagline: clearable(trimmedText(80)),
  logoKey: clearable(trimmedText(500)),
  logoDarkKey: clearable(trimmedText(500)),
  faviconKey: clearable(trimmedText(500)),
});
export type UpdateBrandingDto = z.infer<typeof updateBrandingSchema>;
