import { boundedInt } from './bounded-int';

/**
 * Weekly MongoDB snapshot settings (PAC-172).
 *
 * Every parser takes the raw value (`ConfigService.get`), the
 * `acme.config.ts` pattern, so the repo `.env` works locally and a test can set
 * `process.env` around a single case. The schedule is a constant, not a
 * setting: like every other cron here, changing it is a code change.
 */

/**
 * Sundays at 13:00 Pakistan time.
 *
 * That is 08:00 UTC and 03:00 in the agency's own zone (America/Chicago, or
 * 02:00 when it is on standard time) — the quietest hour of the quietest day,
 * which matters because a dump of a single-node cluster competes with the app
 * for the same vCPU. Pakistan does not observe daylight saving, so the instant
 * never moves; the Chicago hour shifting twice a year does not matter.
 *
 * If the self-hosted Inngest server ever rejects the `TZ=` prefix at sync,
 * `0 8 * * 0` is the identical schedule.
 */
export const DB_BACKUP_SCHEDULE = 'TZ=Asia/Karachi 0 13 * * 0';

/**
 * Whether this environment takes snapshots at all: `true` in any case turns
 * them on, anything else is off — the `acmeEnabled` shape — so an environment
 * that never set it, or was not given a bucket, does not try and fail every
 * Sunday. The deploy preflight accepts only `true`, `false` or empty, so a
 * value the two could read differently stops the deploy instead.
 */
export function dbBackupEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true';
}

/** One current archive and three older ones. */
export const DEFAULT_DB_BACKUP_KEEP = 4;

/**
 * How many weeks of scheduled archives survive rotation — one archive per week
 * (see `selectKeysToDelete`). Clamped to 1–52: at least the one just written,
 * at most a year of Sundays.
 */
export function dbBackupKeep(raw: string | undefined): number {
  return boundedInt(raw, DEFAULT_DB_BACKUP_KEEP, 1, 52);
}

export const DEFAULT_DB_BACKUP_DUMP_TIMEOUT_MINUTES = 45;

/**
 * How long `mongodump` may run before it is killed, in milliseconds.
 *
 * Clamped to 5–110 minutes. The ceiling stays inside Inngest's two-hour limit
 * on a single step with room left for the upload, which happens in the same
 * step; a dump that is killed fails that attempt rather than outliving it.
 */
export function dbBackupDumpTimeoutMs(raw: string | undefined): number {
  return (
    boundedInt(raw, DEFAULT_DB_BACKUP_DUMP_TIMEOUT_MINUTES, 5, 110) * 60_000
  );
}

/**
 * Collections dumped at once. mongodump's own default is 4, which is a lot to
 * ask of a one-vCPU cluster that is still serving the app; 2 trades a slower
 * dump for a lighter one.
 */
export const DEFAULT_DB_BACKUP_DUMP_PARALLEL = 2;

export function dbBackupDumpParallel(raw: string | undefined): number {
  return boundedInt(raw, DEFAULT_DB_BACKUP_DUMP_PARALLEL, 1, 8);
}

/**
 * Who hears about every run. Required by the deploy preflight wherever
 * backups are enabled; unset locally means the outcome is only logged.
 */
export function dbBackupAlertEmail(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}
