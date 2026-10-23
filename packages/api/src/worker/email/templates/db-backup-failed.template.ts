import { formatUtc } from './db-backup-report.template';
import { layout, muted, paragraph } from './layout';
import type { Template } from './template.types';

/**
 * Where a run failed, which decides what the mail may honestly say about the
 * archives:
 *
 * - `plan` / `snapshot` — before or during the dump and upload: this run stored
 *   nothing, and nothing was deleted.
 * - `rotate` — after the upload: this run's archive is stored; older weekly
 *   archives may not have been pruned.
 * - `notify` — after upload and rotation: only the report could not be sent.
 * - `request` — Inngest rejected the request before the function ran (an Invoke
 *   or a `curl` without a valid `reason`): no snapshot was attempted.
 * - `unknown` — the error carried no step; the dashboard has the detail.
 */
export type DbBackupFailureStage =
  'request' | 'plan' | 'snapshot' | 'rotate' | 'notify' | 'unknown';

/** What the "snapshot FAILED" mail renders from (PAC-172). */
export interface DbBackupFailedData {
  to: string;
  host: string;
  kind: 'scheduled' | 'manual' | 'pre-deploy';
  label: string | null;
  stage: DbBackupFailureStage;
  bucket: string;
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

function consequence(data: DbBackupFailedData): string {
  switch (data.stage) {
    case 'plan':
    case 'snapshot':
      return 'This run stored no archive and deleted none. Older archives are only ever deleted after a new one is stored, so the existing ones are untouched.';
    case 'rotate':
      return `This run's archive was stored in ${data.bucket}, but rotation failed, so older weekly archives may not have been pruned. The next weekly run prunes again.`;
    case 'notify':
      return 'This run stored its archive and rotated; only the report could not be sent.';
    case 'request':
      return 'No snapshot was attempted, and the existing archives are untouched. A requested snapshot needs data with a "reason" of "manual" or "pre-deploy".';
    case 'unknown':
      return "The error does not say which step failed; the run's steps in the Inngest dashboard do.";
  }
}

/**
 * "Snapshot FAILED" — sent from the function's `onFailure`, once the run has
 * stopped retrying.
 *
 * The error text comes from mongodump, the S3 client, our own guards or
 * Inngest's validation, and is escaped like any other value (`paragraph` does
 * it). Credentials are already masked out of it by `MongoDumpRunner`.
 */
export const dbBackupFailedTemplate: Template<DbBackupFailedData> = {
  key: 'dbBackupFailed',

  subject: (data) =>
    data.stage === 'request'
      ? `DB snapshot request REJECTED — ${data.host}`
      : `DB backup FAILED — ${data.host}`,

  render: (data) => {
    const what =
      data.stage === 'request'
        ? `A database snapshot request to ${data.host} was rejected on ${formatUtc(data.failedAt)} before it ran.`
        : `The ${KIND_NOUN[data.kind]} of ${data.host} failed on ${formatUtc(data.failedAt)}${data.label ? ` (${data.label})` : ''} and has stopped retrying.`;
    const error = `Error: ${data.error}`;
    const after = consequence(data);
    const backstop =
      "DigitalOcean's own daily backups of the cluster are unaffected.";
    const where = `Inngest run ${data.runId}. Open the dashboard through the tunnel (ssh -L 8288:localhost:8288 deploy@<inngest droplet>, then http://localhost:8288) for the full log, and see DEPLOYMENT.md, "Database backups".`;

    const html = layout({
      preheader: `${data.host}: ${data.stage === 'request' ? 'a snapshot request was rejected' : `the ${KIND_NOUN[data.kind]} failed`}.`,
      body: [
        paragraph(what),
        paragraph(error),
        paragraph(after),
        muted(backstop),
        muted(where),
      ].join('\n'),
    });

    const text = [
      what,
      '',
      error,
      '',
      after,
      '',
      backstop,
      '',
      where,
      '',
      'This is an automated message from AgencyOps. Please do not reply to it.',
    ].join('\n');

    return { html, text };
  },
};
