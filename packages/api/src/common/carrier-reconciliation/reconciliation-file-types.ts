import { XLSX_CONTENT_TYPE } from '../mailers/mailer-file-types';

/**
 * Object-key namespace for uploaded Dash reports.
 *
 * The **same constant** mints the key (`StorageService.buildObjectKey`) and
 * verifies the one a client hands back (`assertKeyOwnership`). Two spellings
 * would make every upload "not yours". Lives in `common/` so a worker job can
 * read the file under the same prefix later.
 */
export const RECONCILIATION_PURPOSE = 'carrier-reconciliation';

/**
 * Days either side of the report period that app sales are loaded for, so a
 * Dash line issued on the 1st can be suggested against a sale typed in on the
 * 30th of the month before. Matching itself is by policy number and never
 * looks at dates.
 */
export const RECONCILIATION_WINDOW_PAD_DAYS = 14;

/**
 * Carriers whose new business the Dash report carries. National General is
 * Allstate's, written through the same agency code.
 */
export const DASH_CARRIER_NAMES = [
  'Allstate',
  'National General',
  'National General Insurance',
] as const;

/** Content types a browser may report for an `.xlsx`; a hint, never the decision. */
export const ALLOWED_RECONCILIATION_CONTENT_TYPES = [
  XLSX_CONTENT_TYPE,
  'application/vnd.ms-excel',
  'application/zip',
  'application/octet-stream',
] as const;

/**
 * What the presigned PUT is signed with. Always the XLSX type: the signature
 * covers `Content-Type`, so it must not depend on what a browser reports.
 */
export const RECONCILIATION_CONTENT_TYPE = XLSX_CONTENT_TYPE;
