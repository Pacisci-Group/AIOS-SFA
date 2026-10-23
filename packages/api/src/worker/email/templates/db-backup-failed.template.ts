import { formatUtc } from './db-backup-report.template';
import { layout, muted, paragraph } from './layout';
import type { Template } from './template.types';

/**
 * Where a run failed, which decides what the mail may honestly say about the
 * archives:
 *
 * - `plan` — before the dump: nothing was stored or deleted.
 * - `snapshot` — the dump or upload: the final attempt stored nothing (an
 *   earlier attempt whose response was lost may have), and nothing was deleted.
 * - `rotate` — after the upload: this run's archive is stored; older weekly
 *   archives may not have been pruned.
 * - `notify` — after upload (and rotation, for a weekly run): only the report
 *   could not be sent.
 * - `record` — the report was sent; only its delivery record failed.
 * - `request` — Inngest rejected the request before the function ran (its data
 *   failed validation): no snapshot was attempted.
 * - `unknown` — the error carried no step (a worker that died mid-step, a
 *   transport failure); the dashboard has the detail.
 */
export type DbBackupFailureStage =
  'request' | 'plan' | 'snapshot' | 'rotate' | 'notify' | 'record' | 'unknown';

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
      return 'This run stored no archive and deleted none. Older archives are only ever deleted after a new one is stored, so the existing ones are untouched.';
    case 'snapshot':
      return `The final attempt stored no archive, and nothing was deleted: older archives are only ever deleted after a new one is stored. (An earlier attempt whose response was lost may have stored one — look in ${data.bucket} for a key from this run's start time.)`;
    case 'rotate':
      return `This run's archive was stored in ${data.bucket}, but rotation failed, so older weekly archives may not have been pruned. The next weekly run prunes again.`;
    case 'notify':
      return data.kind === 'scheduled'
        ? 'This run stored its archive and rotated; only the report could not be sent.'
        : 'This run stored its archive; only the report could not be sent.';
    case 'record':
      return 'This run stored its archive and sent its report; only the delivery record could not be written.';
    case 'request':
      return 'No snapshot was attempted, and the existing archives are untouched. The request\'s data failed validation, and the error above names the field. A request needs a "reason" of "manual" or "pre-deploy", and an optional "label" of at most 200 characters.';
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

  subject: (data) => {
    switch (data.stage) {
      case 'request':
        return `DB snapshot request REJECTED — ${data.host}`;
      case 'notify':
        return `DB backup stored, report FAILED — ${data.host}`;
      case 'record':
        return `DB backup stored, delivery record FAILED — ${data.host}`;
      default:
        return `DB backup FAILED — ${data.host}`;
    }
  },

  render: (data) => {
    const when = formatUtc(data.failedAt);
    const label = data.label ? ` (${data.label})` : '';
    const what =
      data.stage === 'request'
        ? `A database snapshot request to ${data.host} was rejected on ${when} before it ran.`
        : data.stage === 'notify' || data.stage === 'record'
          ? `The ${KIND_NOUN[data.kind]} of ${data.host}${label} stored its archive, but its run failed afterwards on ${when} and has stopped retrying.`
          : `The ${KIND_NOUN[data.kind]} of ${data.host} failed on ${when}${label} and has stopped retrying.`;
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
