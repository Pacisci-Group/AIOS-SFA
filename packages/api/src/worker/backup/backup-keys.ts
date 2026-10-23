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
 * **lexicographic order is chronological order**. Rotation sorts on the key and
 * reads the instant back only from a key that has already matched the exact
 * archive pattern.
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
const SCHEDULED_ARCHIVE =
  /^weekly\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.archive\.gz$/;

/**
 * Scheduled archives closer together than this are the same week.
 *
 * The cron fires exactly seven days apart, so two `weekly/` archives within six
 * days of each other mean the week was run twice — a dashboard Rerun or Replay
 * of a weekly run, which starts again from the cron's timer event and is
 * indistinguishable from the cron itself. Without this, each such run would
 * count as a restore point and push a real older week out of rotation.
 */
export const WEEKLY_SLOT_MS = 6 * 24 * 60 * 60_000;

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

/** When a scheduled archive was taken, from its key; `null` for any other key. */
export function scheduledArchiveTime(key: string): number | null {
  const m = SCHEDULED_ARCHIVE.exec(key);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/**
 * Which scheduled archives to delete so that one per week, for the newest
 * `keep` weeks, remains.
 *
 * Walks the archives newest first and keeps each one that is not within
 * {@link WEEKLY_SLOT_MS} of an archive already kept, until `keep` are kept. So
 * the normal case is exactly "the new archive and the three before it, oldest
 * deleted", and a re-run week costs its own earlier archive — never an older
 * week's.
 *
 * `protect` is the archive the run just wrote. It is considered first, always
 * survives and counts toward `keep` — even if it sorts oldest, which a skewed
 * clock could make it — so rotation can never delete the one archive it has
 * just proved exists. Everything that is not a scheduled archive is ignored,
 * never returned. Callers delete every key returned, in any order.
 */
export function selectKeysToDelete(
  keys: readonly string[],
  keep: number,
  { protect }: { protect?: string } = {},
): string[] {
  const archives = keys.filter(isScheduledArchiveKey);
  const ordered = [
    ...(protect !== undefined && archives.includes(protect) ? [protect] : []),
    ...archives
      .filter((key) => key !== protect)
      .sort()
      .reverse(), // newest first
  ];

  const kept: number[] = [];
  const doomed: string[] = [];
  for (const key of ordered) {
    const at = scheduledArchiveTime(key) as number;
    const sameWeek = kept.some((t) => Math.abs(t - at) < WEEKLY_SLOT_MS);
    if (key !== protect && (kept.length >= keep || sameWeek)) {
      doomed.push(key);
    } else {
      kept.push(at);
    }
  }
  return doomed;
}
