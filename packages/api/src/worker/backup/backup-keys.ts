/**
 * Where snapshots live in the backup bucket, and which of them rotation may
 * delete (PAC-172).
 *
 * Pure — no imports, no clock, no bucket — because these few lines decide what
 * gets deleted, and they are tested on their own.
 *
 * ## Layout
 *
 * | Prefix | Written by | Retention |
 * |---|---|---|
 * | `weekly/` | the Sunday cron | newest `DB_BACKUP_KEEP`, rotated by the worker |
 * | `manual/` | an operator's request | the bucket's lifecycle rule (Terraform) |
 * | `pre-deploy/` | a deploy's request | the bucket's lifecycle rule (Terraform) |
 *
 * The timestamp is compact UTC (`20261025T080012Z`), so within a prefix
 * **lexicographic order is chronological order**: rotation is a sort, never a
 * date parse that could misread a key.
 */

export type SnapshotKind = 'scheduled' | 'manual' | 'pre-deploy';

/** The only prefix rotation ever lists or deletes from. */
export const SCHEDULED_PREFIX = 'weekly/';

const PREFIXES: Record<SnapshotKind, string> = {
  scheduled: SCHEDULED_PREFIX,
  manual: 'manual/',
  'pre-deploy': 'pre-deploy/',
};

export const ARCHIVE_SUFFIX = '.archive.gz';
export const ARCHIVE_CONTENT_TYPE = 'application/gzip';

/**
 * A scheduled archive, exactly. Anything else under `weekly/` — a README, a
 * hand-copied file, a half-renamed key — is not ours to delete, so rotation
 * matches this and nothing looser.
 */
const SCHEDULED_ARCHIVE = /^weekly\/\d{8}T\d{6}Z\.archive\.gz$/;

/** Labels long enough to say what they guard, short enough to read in a list. */
const LABEL_MAX_LENGTH = 40;

/** `2026-10-25T08:00:12.345Z` → `20261025T080012Z`. */
export function compactUtc(at: Date): string {
  return at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/**
 * A label reduced to one safe key segment — the same rule as
 * `StorageService`'s `objectKeySegment`: lowercase, anything outside
 * `[a-z0-9.\-_]` collapsed to a dash. That is what makes `/` unrepresentable,
 * so a label can never move an archive out of its prefix (and into `weekly/`,
 * where rotation would count it).
 */
export function safeLabel(label: string | null | undefined): string {
  return (label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LABEL_MAX_LENGTH)
    .replace(/-+$/, '');
}

/**
 * The key a snapshot is stored under.
 *
 * Scheduled archives carry no label: their name must match
 * {@link SCHEDULED_ARCHIVE} exactly or rotation would never see them.
 */
export function buildArchiveKey(
  kind: SnapshotKind,
  at: Date,
  label?: string | null,
): string {
  const stamp = compactUtc(at);
  if (kind === 'scheduled') {
    return `${SCHEDULED_PREFIX}${stamp}${ARCHIVE_SUFFIX}`;
  }
  const suffix = safeLabel(label);
  return `${PREFIXES[kind]}${stamp}${suffix ? `-${suffix}` : ''}${ARCHIVE_SUFFIX}`;
}

export function isScheduledArchiveKey(key: string): boolean {
  return SCHEDULED_ARCHIVE.test(key);
}

/**
 * Which scheduled archives to delete so that `keep` remain.
 *
 * `protect` is the archive the run just wrote. It always survives and counts
 * toward `keep` — even if it sorts oldest, which a skewed clock could make it —
 * so rotation can never delete the one archive it has just proved exists.
 * Everything that is not a scheduled archive is ignored, never returned.
 *
 * Returned oldest-last is not promised; callers delete every key returned.
 */
export function selectKeysToDelete(
  keys: readonly string[],
  keep: number,
  { protect }: { protect?: string } = {},
): string[] {
  const protectedPresent = protect !== undefined && keys.includes(protect);
  const others = keys
    .filter(isScheduledArchiveKey)
    .filter((key) => key !== protect)
    .sort()
    .reverse(); // newest first
  const othersToKeep = Math.max(0, keep - (protectedPresent ? 1 : 0));
  return others.slice(othersToKeep);
}
