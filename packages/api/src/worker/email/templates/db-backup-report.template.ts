import { layout, muted, paragraph } from './layout';
import type { Template } from './template.types';

/**
 * What the "snapshot OK" mail renders from (PAC-172). Assembled by
 * `DbBackupSnapshotFn` once the archive is stored and rotation has run.
 */
export interface DbBackupReportData {
  to: string;
  /** Which environment — its PLATFORM_HOST, e.g. `app.smithfamily.agency`. */
  host: string;
  kind: 'scheduled' | 'manual' | 'pre-deploy';
  label: string | null;
  bucket: string;
  key: string;
  bytes: number;
  dumpSeconds: number;
  /** First line of `mongodump --version`. */
  toolVersion: string;
  /** Scheduled archives remaining after rotation, newest first. */
  kept: string[];
  deleted: string[];
  /** Why rotation deleted nothing on purpose, or `null`. */
  rotationSkipped: string | null;
  keep: number;
  /** ISO instant the run finished. */
  finishedAt: string;
}

const KIND_TITLE: Record<DbBackupReportData['kind'], string> = {
  scheduled: 'Weekly DB backup',
  manual: 'Manual DB snapshot',
  'pre-deploy': 'Pre-deploy DB snapshot',
};

/** Shared with the failure template. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Date and time with the zone spelled out — UTC, like the other templates. */
export function formatUtc(isoDateTime: string): string {
  return new Date(isoDateTime).toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * "Snapshot OK" — one per successful run, to `DB_BACKUP_ALERT_EMAIL`.
 *
 * ## The weekly one is a heartbeat, not a courtesy
 * A failed run sends its own mail, but a run that never happened sends
 * nothing: a worker that was down all Sunday, a cron that did not sync. So the
 * success mail is what makes silence mean something — no mail by Sunday
 * afternoon Pakistan time is the alarm — and the body says so, for whoever
 * inherits the inbox.
 *
 * Platform mail: no agency brand, no link. The archive is every tenant's data,
 * so the mail names where it is and never offers a way to fetch it.
 */
export const dbBackupReportTemplate: Template<DbBackupReportData> = {
  key: 'dbBackupReport',

  subject: (data) =>
    `${KIND_TITLE[data.kind]} OK — ${data.host} (${formatBytes(data.bytes)})`,

  render: (data) => {
    const what = `The ${KIND_TITLE[data.kind].toLowerCase()} of ${data.host} finished on ${formatUtc(data.finishedAt)}${data.label ? ` (${data.label})` : ''}.`;
    const where = `Archive: ${data.bucket}/${data.key} — ${formatBytes(data.bytes)}, dumped in ${formatDuration(data.dumpSeconds)}.`;

    const retention: string[] =
      data.kind !== 'scheduled'
        ? [
            'Snapshots taken on request are not rotated. The bucket expires them on its own (90 days unless Terraform says otherwise).',
          ]
        : data.rotationSkipped
          ? [
              `Rotation deleted nothing this week: ${data.rotationSkipped}. The next run will catch up.`,
            ]
          : [
              `Weekly archives kept (${data.kept.length} of ${data.keep}): ${data.kept.join(', ') || 'none'}.`,
              data.deleted.length > 0
                ? `Deleted: ${data.deleted.join(', ')}.`
                : `Deleted: nothing — no more than ${data.keep} weekly archives exist yet.`,
            ];

    const heartbeat =
      data.kind === 'scheduled'
        ? 'The next weekly snapshot runs on Sunday at 13:00 Pakistan time (08:00 UTC). If no mail like this one arrives by Sunday afternoon, the snapshot did not run — check the worker and the Inngest dashboard.'
        : null;
    const tool = `Taken with ${data.toolVersion}.`;

    const html = layout({
      preheader: `${data.host}: ${formatBytes(data.bytes)} stored.`,
      body: [
        paragraph(what),
        paragraph(where),
        ...retention.map(paragraph),
        ...(heartbeat ? [muted(heartbeat)] : []),
        muted(tool),
      ].join('\n'),
    });

    const text = [
      what,
      '',
      where,
      '',
      ...retention,
      ...(heartbeat ? ['', heartbeat] : []),
      '',
      tool,
      '',
      'This is an automated message from AgencyOps. Please do not reply to it.',
    ].join('\n');

    return { html, text };
  },
};
