import {
  apiFetch,
  setStoredUser,
  setTokens,
  type AuthUser,
} from '@/lib/api-client';

/**
 * Image types the API accepts for a profile photo. SVG is excluded server-side
 * (executable markup served from our own origin); mirrored here so the file
 * picker refuses it up front rather than after an upload. Must match
 * `AVATAR_IMAGE_TYPES` / `AVATAR_MAX_BYTES` in the API's `profile.dto.ts`.
 */
export const AVATAR_ACCEPT = 'image/png,image/jpeg,image/webp';
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

interface PresignedUpload {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
}

/**
 * Edit own name. Every mutation in this file returns the same auth-user blob
 * as `GET /auth/me` and re-stores it, so the caller only has to tell React
 * (`refreshUser()` / `adoptSession()`) — the persisted copy is already fresh.
 */
export async function updateMyProfile(input: {
  firstName: string | null;
  lastName: string | null;
}): Promise<AuthUser> {
  const user = await apiFetch<AuthUser>('/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  setStoredUser(user);
  return user;
}

/**
 * Presign, PUT the bytes straight to storage, then commit the key — the same
 * three-step shape as `uploadBrandingImage`, and the raw `fetch` for the PUT
 * is load-bearing for the same reason: it goes to the storage host, and an
 * extra `Authorization` header would not match the signature.
 */
export async function uploadAvatar(file: File): Promise<AuthUser> {
  const presigned = await apiFetch<PresignedUpload>('/me/avatar/uploads', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });

  const put = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: presigned.requiredHeaders,
    body: file,
  });
  if (!put.ok) {
    throw new Error(`Upload failed (${put.status}). Try again.`);
  }

  return commitAvatar(presigned.key);
}

/** Remove the photo. `null` is a clear; omitting the key would leave it. */
export function removeAvatar(): Promise<AuthUser> {
  return commitAvatar(null);
}

async function commitAvatar(key: string | null): Promise<AuthUser> {
  const user = await apiFetch<AuthUser>('/me/avatar', {
    method: 'PATCH',
    body: JSON.stringify({ key }),
  });
  setStoredUser(user);
  return user;
}

export interface ChangePasswordResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * Authenticated password change (PAC-81).
 *
 * ⚠ Same contract as `resetPassword`: the API bumps `tokenVersion`, which ends
 * **every** session for the account — including the one making this request.
 * Storing the returned pair is therefore not a convenience, it is what
 * replaces the credentials this call just invalidated; without it the very
 * next request would 401 and the fetch wrapper would sign the user out.
 *
 * A wrong current password comes back as a `400` (deliberately not a 401, so
 * a typo cannot trip the wrapper's session-expiry path).
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  const data = await apiFetch<ChangePasswordResult>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  setTokens(data.accessToken, data.refreshToken);
  setStoredUser(data.user);
  return data;
}
