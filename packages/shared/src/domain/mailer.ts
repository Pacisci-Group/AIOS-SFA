/**
 * Mailer prospect records and the import runs that create them (PAC-73).
 *
 * A **mailer** is one row of a direct-mail campaign file: a household that was
 * mailed a pre-filled insurance quote, keyed by the Quote Control Number
 * printed on the mail piece. A producer looks one up by that number and logs it
 * as a lead (PAC-61).
 *
 * ## Two sources, one shape
 *
 * Mailers reach Mongo two ways — an operator uploading an agency's RTP final
 * file through the Super Admin panel, and a one-off BigQuery backfill of the
 * legacy history. Both funnel through the same mapper and the same upsert, and
 * the field set below is a **superset**: BigQuery carries campaign columns the
 * RTP file does not (`week_number`, `mail_drop_date`, `start_mon`/`end_sun`,
 * `campaign_status`), so those are optional and simply absent on an uploaded
 * mailer. Never make one source's extra field required — two independently
 * written mappers over near-identical data is how the sources drift into
 * producing different documents for the same mailer.
 */

/**
 * Where a mailer document came from.
 *
 * Deliberately source-agnostic and deliberately **closed at two members**: the
 * demo seed writes `'spreadsheet'` with `recordSource: 'demo:seed'` rather than
 * widening this union, mirroring how `ProducerGoal` marks its demo rows.
 */
export type MailerSourceSystem = 'bigquery' | 'spreadsheet';

/**
 * Lifecycle of one import run.
 *
 * `previewing` → `previewed` → `importing` → `completed`, with `failed`
 * reachable from either working state. The operator sees the parse result at
 * `previewed` and nothing has been written yet; `commit` is what moves it on.
 */
export type MailerImportRunStatus =
  | 'previewing'
  | 'previewed'
  | 'importing'
  | 'completed'
  | 'failed';

/**
 * What the file says about itself, read during the preview parse.
 *
 * Every one of these columns holds exactly one distinct value across all 20,405
 * rows of the reference file — which is what makes "one file = one campaign,
 * one agency, one product" a safe model and agency selection a per-upload
 * choice rather than a per-row attribution.
 */
export interface MailerImportDetected {
  /** The file's `agencyid` column, e.g. `A0B9049`. Cross-checked, never trusted. */
  agencyId: string | null;
  /** The file's `agencyname` column, e.g. `SMITH FAMILY AGENCY`. */
  agencyName: string | null;
  /** `Campaign Number`, always of the form `Week_Number-29`. */
  campaignNumber: string | null;
  /** Derived from {@link campaignNumber}; not a separate column in the file. */
  weekNumber: number | null;
  /** The pipeline's own `FileName`, e.g. `SFA-20P`. Not the uploaded filename. */
  fileName: string | null;
  /** `quotedate`, converted from its Excel serial. ISO date string. */
  quoteDate: string | null;
  /** `type`, e.g. `Home`. */
  policyType: string | null;
  /** `product`, e.g. `FQ`. */
  product: string | null;
}

/** Row tallies for one run. `skipped` always equals `rejections.length`. */
export interface MailerImportCounts {
  /** Data rows read from the source, excluding the header. */
  read: number;
  /** Rows that mapped cleanly and were sent to Mongo. */
  mapped: number;
  /** New documents. */
  created: number;
  /** Documents that already existed and were updated in place. */
  updated: number;
  /** Rows dropped. See {@link MailerImportRejection}. */
  skipped: number;
}

/** Why one row did not make it, with enough context to find it in the file. */
export interface MailerImportRejection {
  /** 1-based position among data rows, for pointing at the source file. */
  row: number;
  /** Whichever control-number form was present, for a human to search on. */
  controlNumber: string | null;
  reason: string;
}

/** The report a run produces, and the poll target while it is producing it. */
export interface MailerImportRun {
  id: string;
  agencyId: string;
  status: MailerImportRunStatus;
  /** The name the operator's browser sent. */
  uploadedFilename: string;
  sizeBytes: number;
  detected: MailerImportDetected | null;
  /**
   * The file's own agency does not match the agency the operator chose.
   *
   * Set during the preview parse. Committing anyway requires an explicit
   * confirmation on the request — filing one agency's prospects under another
   * is the failure that matters here.
   */
  agencyMismatch: boolean;
  counts: MailerImportCounts | null;
  /**
   * A capped sample, not the full list. 20,405 rejections would not fit in a
   * response; `counts.skipped` is the authoritative total.
   */
  rejections: MailerImportRejection[];
  /** Present only when `status` is `failed`. */
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** Short-lived presigned URL for the raw uploaded file. */
  rawFileUrl?: string;
}

/** How many rejections a run stores and returns. */
export const MAILER_IMPORT_REJECTION_SAMPLE_SIZE = 50;

// ---------------------------------------------------------------------------
// The Mailers drawer (PAC-61) — what `GET /mailers/:controlNumber` returns
// ---------------------------------------------------------------------------

/**
 * ⚠ This is the **complete** payload a producer sees for a mailer. It is a
 * deliberate projection, not the document.
 *
 * Withheld on purpose: `_id`, `agencyId`, `isTestRecord`, the whole `source`
 * block (`storageKey`, `runId` and `raw` — `raw` is the entire 132-column
 * source row, including the postal `dpv_*`/`coa_*` address-standardisation
 * columns), `gender`, `agencyPhone` (a dynamic local-presence dial number that
 * is explicitly *not* tenant identity), `market`, `address.zip4`, and the
 * campaign's `fileName`, `campaignNumber` (a restatement of `weekNumber`) and
 * `quoteStatus`. Widening this is a decision, not a tweak.
 */
export interface MailerLookupAddress {
  street: string | null;
  city: string | null;
  state: string | null;
  /** 5-digit. The ZIP+4 is postal metadata and stays out of the drawer. */
  zip: string | null;
  /**
   * The resolved county **name** (`'Tulsa County'`), never the zero-padded FIPS
   * code the source ships. Legacy showed producers "County: 083".
   *
   * `null` when the state/FIPS pair is not in the server-side table — today
   * that is anything outside Oklahoma. The drawer omits the row entirely rather
   * than rendering a dash, because a dash claims we looked and found nothing.
   */
  county: string | null;
}

/** The quoted coverage the prospect received, so a producer can read it back. */
export interface MailerLookupCoverage {
  /** Coverage A. */
  dwelling: number | null;
  /** Coverage B. */
  otherStructures: number | null;
  /** Coverage D. */
  lossOfUse: number | null;
  guestMedical: number | null;
  familyLiability: number | null;
}

/**
 * ⚠ `yearly` and `total` are **two different figures**, not restatements.
 *
 * Measured across all 20,405 rows of the reference file, `yearly` never equals
 * `total` on a single row and the ratio between them spans 0.46–2.95. `yearly`
 * is the headline because it is the mailed offer — pre-formatted at source as
 * `"$1886.15/year*"` with a printed-offer footnote, equal to `monthly × 12`,
 * and the only premium legacy ever fetched or displayed. `total` is shown
 * below it, source-labelled. Neither is presented as "our quote" until the
 * product owner rules (PAC-61 open item 1), because a wrong label misquotes a
 * live prospect.
 */
export interface MailerLookupPremium {
  /** `yearlyprem` — the mailed offer. */
  yearly: number | null;
  /** `monthlypre`. */
  monthly: number | null;
  /** `totalpremi` — straight from the mail file, untouched by the pipeline. */
  total: number | null;
}

export interface MailerLookupCampaign {
  weekNumber: number | null;
  /** `type`, e.g. `Home`. */
  policyType: string | null;
  /** `product`, e.g. `FQ`. */
  product: string | null;
  /**
   * `Active` / `Closed`. Present only on BigQuery-backfilled mailers — the
   * column does not exist in an RTP file — so this is `null` on anything an
   * operator uploaded, and the drawer renders it only when non-null.
   *
   * Never fabricate it. Legacy's `status` was a hard-coded `'Pending'` literal
   * invented in the API layer, which is exactly the thing not to reproduce.
   */
  status: string | null;
}

/** One mailer, as the drawer renders it. */
export interface MailerLookupView {
  /** `#`+UUID. The canonical value stamped onto a lead logged from this mailer. */
  controlNumber: string | null;
  /** The last 12 hex characters — the short form printed on the piece. */
  newControlNumber: string | null;
  /** `fullName`, else `first last`. */
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  address: MailerLookupAddress;
  squareFeet: number | null;
  yearBuilt: number | null;
  coverage: MailerLookupCoverage;
  premium: MailerLookupPremium;
  campaign: MailerLookupCampaign;
  /** ISO date. */
  quoteDate: string | null;
  /**
   * ⚠ `email` and `dateOfBirth` are empty on 100% of rows in the reference
   * file and `phone` on 95.6%. The drawer omits these rows when absent rather
   * than dashing them — a dash reads as data we failed to load, when in fact
   * it is data that will never arrive.
   */
  email: string | null;
  phone: string | null;
  /** `YYYY-MM-DD`. */
  dateOfBirth: string | null;
  /**
   * Suppression flags, carried straight through from the source.
   *
   * Not a display nicety: a producer cold-calling a suppressed record is a
   * real-world compliance problem.
   */
  doNotCall: boolean;
  doNotMail: boolean;
  /**
   * Whether **any** lead in the agency already carries this control number.
   *
   * Agency-wide on purpose, and separate from {@link linkedLeadId}: the point
   * of showing it is to stop a producer logging a mailer a colleague already
   * worked. `POST /mailers/log-lead` would reveal the same fact through
   * `alreadyExisted`, so this discloses nothing new.
   */
  alreadyLogged: boolean;
  /**
   * That lead's id — but **only when it is inside the caller's data scope**.
   *
   * `GET /leads/:id` 404s another producer's lead under `own` scope, so handing
   * back an unreachable id would render a "View lead" button that goes to a
   * not-found page. `null` with `alreadyLogged: true` means "logged by someone
   * else"; the drawer says so instead of offering the link.
   */
  linkedLeadId: string | null;
}

/** `POST /mailers/log-lead`. */
export interface LogMailerLeadResponse {
  leadId: string;
  /**
   * True when the call resolved to a lead that already existed rather than
   * creating one. Three honest routes here, all reported the same way: a
   * submission-token replay (the same mailer logged twice, in either
   * control-number form), the quote-control-number dedupe, and the address
   * dedupe against a recent lead at the same street.
   */
  alreadyExisted: boolean;
}
