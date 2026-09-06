import type {
  MailerCampaign,
  MailerCampaignDefaults,
  MailerCampaignFileUrl,
  MailerCampaignListResponse,
  MailerCampaignRecordsResponse,
  MailerCampaignSettings,
  MailerCampaignStatus,
  MailerCommitRequest,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';
import { uploadToPresignedUrl } from '@/lib/presigned-upload';

/**
 * Mailer Campaigns — the Super Admin panel's campaign runner (PAC-71).
 *
 * Platform-scoped like `platform-users-api.ts`: an operator has no `agencyId`,
 * so nothing here reads the caller's tenant. Every response type comes from
 * `@sfa/shared` rather than being redeclared, so a change on the API side is a
 * compile error here and not a runtime surprise.
 *
 * ## The upload is three calls, not one
 *
 * `presign` → the browser `PUT`s the bytes straight to object storage →
 * `POST /platform/mailer-campaigns`. The file never passes through the API,
 * which is why nothing here posts a `FormData`. {@link createCampaign} runs the
 * whole chain so a caller cannot do two thirds of it.
 */

export type {
  MailerCampaign,
  MailerCampaignDefaults,
  MailerCampaignFileUrl,
  MailerCampaignListResponse,
  MailerCampaignRecordsResponse,
  MailerCampaignSettings,
  MailerCommitRequest,
};

/**
 * What the browser is allowed to pick.
 *
 * Mirrors the API's `ALLOWED_MAILER_CONTENT_TYPES`, and is checked by
 * **extension as well as MIME type**: `File.type` for a `.csv` is `text/csv` on
 * Chrome, `application/vnd.ms-excel` on Windows where Excel owns the extension,
 * and often the empty string on Safari or for a file that came out of a cloud
 * drive. Type alone would reject real files for no reason the operator could
 * act on.
 *
 * The check here is a fast local rejection, never the enforcement point — the
 * API re-reads the object with `HeadObject`, because a declared size and type
 * prove nothing about what was actually uploaded.
 */
export const ALLOWED_CAMPAIGN_FILE_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/octet-stream',
] as const;

export const ALLOWED_CAMPAIGN_FILE_EXTENSIONS = ['.csv', '.xlsx'] as const;

/** 100 MB — the API's `MAX_MAILER_FILE_BYTES`. The real vendor file is ~23 MB. */
export const MAX_CAMPAIGN_FILE_BYTES = 100 * 1024 * 1024;

/** Terminal states — where the wizard stops polling and hands back control. */
export function isCampaignSettled(status: MailerCampaignStatus): boolean {
  return (
    status === 'previewed' ||
    status === 'imported' ||
    status === 'failed' ||
    status === 'superseded'
  );
}

/** A campaign is still working: the preview or the commit job has not settled. */
export function isCampaignWorking(status: MailerCampaignStatus): boolean {
  return status === 'uploaded' || status === 'processing';
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const campaignsKey = ['platform', 'campaigns'] as const;
export const campaignKey = (id: string) => [...campaignsKey, id] as const;
export const campaignRecordsKey = (
  id: string,
  params: ListCampaignRecordsParams,
) => [...campaignKey(id), 'records', params] as const;
export const campaignDefaultsKey = [...campaignsKey, 'defaults'] as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListCampaignsParams {
  page?: number;
  pageSize?: number;
  /** Free text over the campaign name and its `Week_Number-NN`. */
  q?: string;
  status?: MailerCampaignStatus;
  /** Campaigns explicitly assigned to this agency. `all` campaigns match too. */
  agencyId?: string;
  carrierId?: string;
}

function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export function listCampaigns(params: ListCampaignsParams = {}) {
  return apiFetch<MailerCampaignListResponse>(
    `/platform/mailer-campaigns${toQueryString({ ...params })}`,
  );
}

/**
 * What the Run a campaign form prefills with: the last imported campaign's
 * settings, or Apex's own values on a platform that has never run one.
 *
 * ⚠ Defaults only. The campaign stores what actually ran, so editing a rule
 * afterwards never changes what a completed run means.
 */
export function getCampaignDefaults() {
  return apiFetch<MailerCampaignDefaults>(
    '/platform/mailer-campaigns/defaults',
  );
}

export function getCampaign(campaignId: string) {
  return apiFetch<MailerCampaign>(
    `/platform/mailer-campaigns/${encodeURIComponent(campaignId)}`,
  );
}

export interface ListCampaignRecordsParams {
  page?: number;
  pageSize?: number;
  /** Either printed control-number form, or a name prefix. */
  q?: string;
}

export function listCampaignRecords(
  campaignId: string,
  params: ListCampaignRecordsParams = {},
) {
  return apiFetch<MailerCampaignRecordsResponse>(
    `/platform/mailer-campaigns/${encodeURIComponent(campaignId)}/records${toQueryString({ ...params })}`,
  );
}

/**
 * Mint a short-lived download link for one of the campaign's two files.
 *
 * Fetched **after** the click rather than rendered as an `href`, so the link is
 * never followed by something that prefetches the route. Pair it with
 * `openDocumentInNewTab`, which handles the popup blocker.
 */
export function getCampaignFileUrl(
  campaignId: string,
  kind: 'vendor' | 'output',
) {
  return apiFetch<MailerCampaignFileUrl>(
    `/platform/mailer-campaigns/${encodeURIComponent(campaignId)}/files/${kind}/url`,
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface PresignResponse {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}

export interface CreateCampaignInput {
  file: File;
  name?: string;
  carrierId?: string;
  /** `vendor` runs the transform; `processed` imports the file as it stands. */
  source: 'vendor' | 'processed';
  campaignNumber?: string;
  assignment: MailerCampaign['assignment'];
  settings: MailerCampaignSettings;
}

/**
 * Presign, upload the bytes, and record the campaign.
 *
 * Returns a campaign in `uploaded` with the preview job already dispatched.
 * Nothing is written to `mailers` by this or by the job it starts — the
 * operator sees what the file contains before deciding.
 */
export async function createCampaign({
  file,
  ...rest
}: CreateCampaignInput): Promise<MailerCampaign> {
  const presigned = await apiFetch<PresignResponse>(
    '/platform/mailer-campaigns/presign',
    {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, size: file.size }),
    },
  );

  await uploadToPresignedUrl(
    presigned.uploadUrl,
    presigned.requiredHeaders,
    file,
  );

  return apiFetch<MailerCampaign>('/platform/mailer-campaigns', {
    method: 'POST',
    body: JSON.stringify({
      ...rest,
      storageKey: presigned.key,
      uploadedFilename: file.name,
      size: file.size,
    }),
  });
}

export interface UpdateCampaignInput {
  name?: string;
  carrierId?: string;
  campaignNumber?: string;
  assignment?: MailerCampaign['assignment'];
  settings?: MailerCampaignSettings;
}

/**
 * Change the settings and re-preview.
 *
 * The server also writes any `settings.zipResolutions` into the platform ZIP
 * table, which is the whole of the inline resolver flow: the answer given once
 * is reused by every campaign after this one.
 */
export function updateCampaign(campaignId: string, input: UpdateCampaignInput) {
  return apiFetch<MailerCampaign>(
    `/platform/mailer-campaigns/${encodeURIComponent(campaignId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
}

/** Re-dispatch the preview job — the recovery path for a `failed` preview. */
export function previewCampaign(campaignId: string) {
  return apiFetch<MailerCampaign>(
    `/platform/mailer-campaigns/${encodeURIComponent(campaignId)}/preview`,
    { method: 'POST' },
  );
}

/**
 * Start the commit. 202 — the gates passed and the work is queued, not done.
 *
 * `expectedDeleteCount` on an overwrite is the operator's acknowledgement of the
 * number the preview showed them, echoed back rather than recomputed: a count
 * that moved in between is a 409 they must look at, not a delete nobody agreed
 * to.
 */
export function commitCampaign(
  campaignId: string,
  request: MailerCommitRequest,
) {
  return apiFetch<MailerCampaign>(
    `/platform/mailer-campaigns/${encodeURIComponent(campaignId)}/commit`,
    { method: 'POST', body: JSON.stringify(request) },
  );
}

/** Send the completion notice, to the stored recipients or to a new list. */
export function emailCampaignOutput(
  campaignId: string,
  recipients?: string[],
) {
  return apiFetch<{ queued: number }>(
    `/platform/mailer-campaigns/${encodeURIComponent(campaignId)}/email`,
    {
      method: 'POST',
      body: JSON.stringify(recipients?.length ? { recipients } : {}),
    },
  );
}

/**
 * Discard a campaign that never imported.
 *
 * Refused once a campaign is `imported`: `Lead.mailer.campaignId` points at it,
 * and attribution outliving the run is the whole reason the record exists.
 */
export function deleteCampaign(campaignId: string) {
  return apiFetch<{ deleted: true }>(
    `/platform/mailer-campaigns/${encodeURIComponent(campaignId)}`,
    { method: 'DELETE' },
  );
}
