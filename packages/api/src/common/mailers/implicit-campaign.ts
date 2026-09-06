import type { MailerCampaignSource } from '@sfa/shared';

/**
 * Implicit campaigns — the record minted for mailers that predate campaigns
 * (PAC-71).
 *
 * `Mailer.campaignId` is required, so every row written before campaigns
 * existed (the BigQuery backfill, the old Add Mailers uploads, the demo seed)
 * needs one. Rather than a single "legacy" bucket, mailers are grouped by
 * `(agency, week, year)` — the only three things the old data actually says
 * about a campaign — so history charts and groups like everything else, and the
 * campaigns list is not one enormous row.
 *
 * ## Why a pure helper in `common/`
 *
 * Three unrelated callers need to agree on the key byte for byte: the backfill
 * script (a bare Mongoose connection, no models), the BigQuery CLI, and the
 * demo seed. A drifted key in any of them creates a second campaign for rows
 * that belong together, which then reads as a duplicate run that never
 * happened. Same reasoning as the import engine being a plain function.
 */

/** The three facts an implicit campaign is grouped by. */
export interface ImplicitCampaignKeyInput {
  agencyId: string;
  /** `Mailer.campaign.weekNumber`. Null when the source carries none. */
  weekNumber: number | null;
  /** Calendar year of `Mailer.quoteDate`. Null when it has none. */
  year: number | null;
}

/**
 * The value stored on `MailerCampaign.migrationKey`, and the upsert filter.
 *
 * ⚠ Null week and null year collapse to the literal `unknown`, giving **one**
 * catch-all campaign per agency rather than one per un-dated row. Any other
 * choice either loses the grouping or invents a week number.
 */
export function implicitCampaignKey(input: ImplicitCampaignKeyInput): string {
  const week = input.weekNumber === null ? 'unknown' : String(input.weekNumber);
  const year = input.year === null ? 'unknown' : String(input.year);
  return `${input.agencyId}|${week}|${year}`;
}

export interface ImplicitCampaignInput {
  /** The global carrier the mailers are assumed to come from (Allstate). */
  carrierId: unknown;
  /** For the campaign name. Falls back to the agency id when absent. */
  agencyName?: string | null;
  /** `Week_Number-NN`, when the source rows carried one. */
  campaignNumber?: string | null;
  /** The source's `FileName`, e.g. `SFA-20P`. Appended to the name when known. */
  fileName?: string | null;
  source: Extract<MailerCampaignSource, 'migration' | 'demo'>;
}

/**
 * The campaign document for one implicit group.
 *
 * `status: 'imported'` because the mailers are already there — an implicit
 * campaign describes a run that happened somewhere else, not one to perform.
 * `settings: null` is the honest answer: nothing recorded what floor or discount
 * table the original run used, and inventing today's defaults would make the
 * record look reproducible when it is not.
 *
 * Assignment is always `agencies` with the one agency the rows belonged to —
 * their `agencyId` was the whole of their tenancy, so that is exactly what
 * carries across.
 */
export function implicitCampaignDoc(
  key: ImplicitCampaignKeyInput,
  input: ImplicitCampaignInput,
): Record<string, unknown> {
  const label = input.agencyName?.trim() || key.agencyId;
  const week =
    key.weekNumber === null ? 'unknown week' : `week ${key.weekNumber}`;
  const year = key.year === null ? '' : ` ${key.year}`;
  const file = input.fileName?.trim() ? ` (${input.fileName.trim()})` : '';

  return {
    carrierId: input.carrierId,
    name: `${label} — ${week}${year}${file}`,
    campaignNumber: input.campaignNumber ?? undefined,
    weekNumber: key.weekNumber,
    year: key.year,
    status: 'imported',
    source: input.source,
    assignment: { mode: 'agencies', agencyIds: [key.agencyId] },
    carrierAgencyIds: [],
    carrierAgencyNames: [],
    settings: null,
    vendorFile: null,
    outputFile: null,
    stats: null,
    preview: null,
    importCounts: null,
    rejections: [],
    commitMode: null,
    replaceCampaignIds: [],
    expectedDeleteCount: null,
    previewAttempt: 0,
    commitAttempt: 0,
    error: null,
    requestedBy: null,
    supersededByCampaignId: null,
    migrationKey: implicitCampaignKey(key),
  };
}
