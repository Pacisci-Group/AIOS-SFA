import type {
  BugReportContext,
  BugReportReceipt,
  BugScreenshotContentType,
  BugSeverity,
} from '@sfa/shared';
import {
  ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES,
  MAX_BUG_SCREENSHOTS,
  MAX_BUG_SCREENSHOT_BYTES,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * Filing a bug report — the floating widget's client.
 *
 * Three calls per screenshot, not one: presign, `PUT` the bytes straight to
 * object storage, then hand the keys back with the report. The file never
 * passes through the API. Same chain as quote documents and mailer imports.
 *
 * Deliberately separate from `platform-bug-reports-api.ts`: this half is
 * reachable by every signed-in user and needs no permission, that half is
 * behind `platform:bugs:*`. One module for both would put the queue's types in
 * every page's bundle.
 */

export {
  ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES,
  MAX_BUG_SCREENSHOTS,
  MAX_BUG_SCREENSHOT_BYTES,
};

interface PresignResponse {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}

/** A screenshot the browser is holding, before it has been uploaded. */
export interface PendingScreenshot {
  /** Stable local id — `File` identity is not usable as a React key. */
  id: string;
  file: File;
  /** Object URL for the thumbnail. The picker revokes it on removal. */
  previewUrl: string;
}

interface UploadedScreenshot {
  key: string;
  filename: string;
  contentType: BugScreenshotContentType;
  size: number;
}

function presignScreenshot(file: File) {
  return apiFetch<PresignResponse>('/bug-reports/screenshots/presign', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
}

/**
 * Upload the raw bytes.
 *
 * Bare `fetch`, never `apiFetch`: the latter attaches an `Authorization` header
 * and an `X-Branch-Id`, and any header not covered by the presigned signature
 * invalidates it.
 */
async function uploadToPresignedUrl(
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
) {
  const res = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
  if (!res.ok) {
    throw new Error(`Screenshot upload failed (${res.status})`);
  }
}

async function uploadScreenshot(file: File): Promise<UploadedScreenshot> {
  const presigned = await presignScreenshot(file);
  await uploadToPresignedUrl(
    presigned.uploadUrl,
    presigned.requiredHeaders,
    file,
  );
  return {
    key: presigned.key,
    filename: file.name,
    contentType: file.type as BugScreenshotContentType,
    size: file.size,
  };
}

export interface SubmitBugReportInput {
  description: string;
  severity: BugSeverity;
  screenshots: PendingScreenshot[];
  context: BugReportContext;
}

/**
 * Upload every screenshot, then file the report.
 *
 * Uploads run in parallel — five 3 MB PNGs one after another is a visibly slow
 * submit, and they are independent objects. If any one fails the whole submit
 * fails and nothing is written: a report that silently dropped the screenshot
 * proving the bug is worse than one the user is asked to retry.
 */
export async function submitBugReport(
  input: SubmitBugReportInput,
): Promise<BugReportReceipt> {
  const uploaded = await Promise.all(
    input.screenshots.map((screenshot) => uploadScreenshot(screenshot.file)),
  );

  return apiFetch<BugReportReceipt>('/bug-reports', {
    method: 'POST',
    body: JSON.stringify({
      description: input.description,
      severity: input.severity,
      screenshots: uploaded,
      context: input.context,
    }),
  });
}
