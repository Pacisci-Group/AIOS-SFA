import { apiFetch } from '@/lib/api-client';

export interface AgencyBrandingSettings {
  /** The agency's legal name — the fallback when `displayName` is unset. */
  agencyName: string;
  displayName: string | null;
  tagline: string | null;
  hasLogo: boolean;
  hasLogoDark: boolean;
  hasFavicon: boolean;
}

export type BrandingSlot = 'logo' | 'logoDark' | 'favicon';

/**
 * Image types the API accepts.
 *
 * SVG is excluded server-side because it is executable markup served from our
 * own origin under the agency's own hostname. Mirrored here so the file picker
 * refuses it up front rather than after an upload.
 */
export const BRANDING_ACCEPT = 'image/png,image/jpeg,image/webp';
export const BRANDING_MAX_BYTES = 2 * 1024 * 1024;

interface PresignedUpload {
  slot: BrandingSlot;
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

export function getBranding(): Promise<AgencyBrandingSettings> {
  return apiFetch<AgencyBrandingSettings>('/agency/branding');
}

export function updateBranding(input: {
  displayName?: string | null;
  tagline?: string | null;
  logoKey?: string | null;
  logoDarkKey?: string | null;
  faviconKey?: string | null;
}): Promise<AgencyBrandingSettings> {
  return apiFetch<AgencyBrandingSettings>('/agency/branding', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * Presign, PUT the bytes straight to storage, then commit the key.
 *
 * Three steps because the file never passes through the API — the same shape as
 * the deal-audit document upload. The `fetch` for the PUT is deliberately raw
 * rather than `apiFetch`: it goes to the storage host, not our API, and must
 * carry the signed headers and **no** `Authorization` (an extra header would
 * not match the signature and the PUT would be rejected).
 */
export async function uploadBrandingImage(
  slot: BrandingSlot,
  file: File,
): Promise<AgencyBrandingSettings> {
  const presigned = await apiFetch<PresignedUpload>('/agency/branding/uploads', {
    method: 'POST',
    body: JSON.stringify({
      slot,
      filename: file.name,
      contentType: file.type,
    }),
  });

  const put = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: presigned.requiredHeaders,
    body: file,
  });

  if (!put.ok) {
    throw new Error(`Upload failed (${put.status}). Try again.`);
  }

  const field = SLOT_FIELD[slot];
  return updateBranding({ [field]: presigned.key });
}

const SLOT_FIELD: Record<BrandingSlot, 'logoKey' | 'logoDarkKey' | 'faviconKey'> =
  {
    logo: 'logoKey',
    logoDark: 'logoDarkKey',
    favicon: 'faviconKey',
  };

/** Remove one image. `null` is a clear; omitting the key would leave it. */
export function clearBrandingImage(
  slot: BrandingSlot,
): Promise<AgencyBrandingSettings> {
  return updateBranding({ [SLOT_FIELD[slot]]: null });
}
