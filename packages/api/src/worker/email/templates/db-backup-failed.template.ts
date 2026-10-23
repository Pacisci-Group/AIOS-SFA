import { formatUtc } from './db-backup-report.template';
import { layout, muted, paragraph } from './layout';
import type { Template } from './template.types';

/** What the "snapshot FAILED" mail renders from (PAC-172). */
export interface DbBackupFailedData {
  to: string;
  host: string;
  kind: 'scheduled' | 'manual' | 'pre-deploy';
  label: string | null;
  /** The failed run's Inngest id, to find it in the dashboard. */
  runId: string;
  error: string;
  /** ISO instant. */
  failedAt: string;
}

const KIND_NOUN: Record<DbBackupFailedData['kind'], string> = {
  scheduled: 'weekly database snapshot',
  manual: 'manual database snapshot',
  'pre-deploy': 'pre-deploy database snapshot',
};

/**
 * "Snapshot FAILED" — sent from the function's `onFailure`, once the run has
 * stopped retrying.
 *
 * The error text comes from mongodump, the S3 client or our own guards, and is
 * escaped like any other value (`paragraph` does it). Credentials are already
 * masked out of it by `MongoDumpRunner`.
 */
export const dbBackupFailedTemplate: Template<DbBackupFailedData> = {
  key: 'dbBackupFailed',

  subject: (data) => `DB backup FAILED — ${data.host}`,

  render: (data) => {
    const what = `The ${KIND_NOUN[data.kind]} of ${data.host} failed on ${formatUtc(data.failedAt)}${data.label ? ` (${data.label})` : ''} and has stopped retrying.`;
    const error = `Error: ${data.error}`;
    const safety =
      "Older archives are only ever deleted after a new one has been stored, so a failed dump costs no existing archive. DigitalOcean's own daily backups of the cluster are unaffected.";
    const where = `Inngest run ${data.runId}. Open the dashboard through the tunnel (ssh -L 8288:localhost:8288 deploy@<inngest droplet>, then http://localhost:8288) for the full log, and see DEPLOYMENT.md, "Database backups".`;

    const html = layout({
      preheader: `${data.host}: the ${KIND_NOUN[data.kind]} failed.`,
      body: [
        paragraph(what),
        paragraph(error),
        paragraph(safety),
        muted(where),
      ].join('\n'),
    });

    const text = [
      what,
      '',
      error,
      '',
      safety,
      '',
      where,
      '',
      'This is an automated message from AgencyOps. Please do not reply to it.',
    ].join('\n');

    return { html, text };
  },
};
