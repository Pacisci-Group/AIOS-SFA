/**
 * An integer setting read from a raw environment string, clamped to a range.
 *
 * Shared by the config files whose knobs are bounded integers (Data Export,
 * DB backups). Missing or unparseable input falls back rather than throwing: a
 * typo in an optional tuning variable should cost the default, not a boot.
 */
export function boundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
