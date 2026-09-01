import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { apiFetchBlob } from '@/lib/api-client';

/** "Pat Producer" → "PP". Falls back to the first two characters. */
function initialsFromName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return (letters || name.slice(0, 2) || 'U').toUpperCase();
}

/**
 * The photo bytes as an object URL, or `undefined` while loading / when there
 * is no photo.
 *
 * `GET /me/avatar` is authenticated, so an `<img src>` pointed at it would
 * 401 — the bytes come down through `apiFetchBlob` with the bearer header and
 * are handed to the `<img>` as a blob URL instead. Cached forever under the
 * `avatarUrl` itself: the URL carries a key-derived cache-buster, so replacing
 * the photo changes the query key and refetches on its own.
 */
function useAvatarObjectUrl(avatarUrl: string | null): string | undefined {
  const { data: blob } = useQuery({
    queryKey: ['avatar', avatarUrl],
    queryFn: () => apiFetchBlob(avatarUrl!),
    enabled: !!avatarUrl,
    staleTime: Infinity,
    retry: false,
  });

  const [objectUrl, setObjectUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setObjectUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    // Revoked on replacement/unmount — object URLs otherwise live until the
    // tab closes, one orphaned image per photo change.
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return objectUrl;
}

/**
 * A user's photo with their initials behind it (PAC-81).
 *
 * The one place the app composes `AvatarImage` — everywhere that shows a
 * person should come through here rather than growing another initials
 * helper (the sidebar chip and the profile page both do). `fallbackClassName`
 * exists because call sites legitimately differ: the sidebar's fallback
 * carries a deliberate `dark:` pairing that a card on the profile page does
 * not want.
 */
export function UserAvatar({
  name,
  avatarUrl,
  className,
  fallbackClassName,
}: {
  /** Display name — the initials source. */
  name: string;
  /** `AuthUser.avatarUrl`; null renders initials only. */
  avatarUrl: string | null;
  className?: string;
  fallbackClassName?: string;
}) {
  const objectUrl = useAvatarObjectUrl(avatarUrl);

  return (
    <Avatar className={className}>
      {objectUrl && <AvatarImage src={objectUrl} alt="" />}
      <AvatarFallback className={fallbackClassName}>
        {initialsFromName(name)}
      </AvatarFallback>
    </Avatar>
  );
}
