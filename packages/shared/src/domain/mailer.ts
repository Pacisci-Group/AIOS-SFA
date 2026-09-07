/**
 * Mailer prospect records (PAC-73), and what the drawer shows for one (PAC-61).
 *
 * A **mailer** is one row of a direct-mail campaign file: a household that was
 * mailed a pre-filled insurance quote, keyed by the Quote Control Number
 * printed on the mail piece. A producer looks one up by that number and logs it
 * as a lead.
 *
 * ## Two sources, one shape
 *
 * Mailers reach Mongo two ways — a campaign run (PAC-71), and a one-off
 * BigQuery backfill of the legacy history. Both funnel through the same mapper
 * and the same upsert, and the field set below is a **superset**: BigQuery
 * carries campaign columns a vendor file does not (`week_number`,
 * `mail_drop_date`, `start_mon`/`end_sun`, `campaign_status`), so those are
 * optional and simply absent on an uploaded mailer. Never make one source's
 * extra field required — two independently written mappers over near-identical
 * data is how the sources drift into producing different documents for the same
 * mailer.
 *
 * ## Tenancy lives on the campaign
 *
 * A mailer has no `agencyId`. It carries `campaignId` and the
 * `visibleAgencyIds` its campaign's assignment resolved for that row — see
 * `mailer-campaign.ts`. The import-run types that used to live here went with
 * the Add Mailers flow they described.
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
 * What the file says about itself, read during the preview parse.
 *
 * Every one of these columns holds exactly one distinct value across all 20,405
 * rows of the reference file — which is what makes "one file = one campaign,
 * one agency, one product" a safe model and agency selection a per-upload
 * choice rather than a per-row attribution.
 */
export interface MailerImportDetected {
  /**
   * The file's `agencyid` column, e.g. `A0B9049` — the **carrier's** code for
   * the issuing agency, not one of our agency ids.
   *
   * Renamed from `agencyId` in PAC-71 because it stopped being a cross-check
   * and became the routing key: it is matched against the carrier appointments
   * (PAC-93) to decide which tenants a row is visible to. A field named
   * `agencyId` sitting next to our own agency ids is exactly the confusion that
   * files one agency's prospects under another.
   */
  carrierAgencyId: string | null;
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
   * Whether **any** lead on the platform is already linked to this mailer.
   *
   * ⚠ Platform-wide since PAC-71, not agency-wide. One campaign can be visible
   * to several tenants and a mailer may be logged exactly once across all of
   * them — the first agency to log it owns it. Every other agency's drawer sees
   * `true` here with {@link linkedLeadId} `null` and the action disabled, and
   * learns nothing about which agency or which lead: that is another tenant's
   * data. `POST /mailers/log-lead` from such an agency is a 409.
   *
   * Within the caller's own agency this discloses nothing new — `log-lead`
   * would reveal the same fact through `alreadyExisted`.
   */
  alreadyLogged: boolean;
  /**
   * That lead's id — but **only when it is inside the caller's data scope**.
   *
   * `GET /leads/:id` 404s another producer's lead under `own` scope, so handing
   * back an unreachable id would render a "View lead" button that goes to a
   * not-found page. `null` with `alreadyLogged: true` means "logged by someone
   * else" — a colleague out of scope, or another agency entirely, deliberately
   * indistinguishable. The drawer says "Already logged." and offers no link.
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
