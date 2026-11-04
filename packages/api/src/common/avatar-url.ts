import { createHash } from 'crypto';

/**
 * The relative URL a client fetches a profile photo from (PAC-81, PAC-162).
 *
 * A stable path rather than a presigned URL: the auth blob sits in
 * `localStorage` indefinitely, and the People list is cached by TanStack
 * Query, so anything that expires would rot there. The client fetches the
 * path with its own auth header. `v` is a cache-buster derived from the
 * object key — the tenant-logo convention — so replacing the photo changes
 * the URL and nothing else does.
 *
 * `/me/avatar` for the caller's own blob; `/users/:id/avatar` for a person
 * on the People pages. Null without a photo.
 */
export function avatarUrlFor(
  path: string,
  avatarKey: string | null | undefined,
): string | null {
  if (!avatarKey) return null;
  const version = createHash('sha1')
    .update(avatarKey)
    .digest('hex')
    .slice(0, 8);
  return `${path}?v=${version}`;
}
