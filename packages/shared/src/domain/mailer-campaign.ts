/**
 * Mailer campaigns (PAC-71).
 *
 * A **campaign** is one run of a vendor mail file: the operator uploads the
 * file the data/print vendor returned, we run the SFA-Processor transform
 * ourselves, write the resulting {@link MailerLookupView | mailers}, produce the
 * 132-column print CSV, and keep the whole thing — settings, stats, both files —
 * on one record so the run is reproducible from its own document.
 *
 * ## A campaign is run once and can serve many agencies
 *
 * This is the shape-defining decision. `Mailer.agencyId` is gone; a mailer
 * carries `campaignId` plus `visibleAgencyIds`, resolved **per row** from the
 * campaign's {@link MailerCampaignAssignment}. One file whose `agencyid` column
 * carries two carrier agency codes therefore splits across two tenants without
 * being uploaded twice.
 *
 * ⚠ `visibleAgencyIds: null` means "every agency, including ones onboarded
 * later". Querying it needs `{ $type: 'null' }`, **never** `null` — a bare
 * `null` also matches a *missing* field, which would make every mailer a
 * migration has not yet reached visible to every tenant.
 */

import type { MailerImportCounts, MailerImportRejection } from './mailer';

// ---------------------------------------------------------------------------
// Pricing rules — the transform's only configurable part
// ---------------------------------------------------------------------------

/** One square-footage band: homes at or above `minSquareFeet` get `rate` off. */
export interface SquareFootageBand {
  minSquareFeet: number;
  /** Fraction, e.g. `0.44`. */
  rate: number;
}

/**
 * The discount table a campaign ran with.
 *
 * Lives in `shared` rather than beside the processor because the campaign
 * **stores** it (a run must be reproducible) and the web wizard **edits** it, so
 * three layers need the same type. `mailer-processor.ts` re-exports it, and its
 * `DEFAULT_MAILER_DISCOUNTS` remains the single source of the default values —
 * do not restate those numbers here.
 */
export interface MailerDiscountRules {
  /**
   * Evaluated largest `minSquareFeet` first; the first band the home reaches
   * wins. A home below every band gets no size discount.
   */
  squareFootage: SquareFootageBand[];
  homeAge: {
    /** A home this many years old or newer gets `newRate`; older gets `oldRate`. */
    maxNewYears: number;
    newRate: number;
    oldRate: number;
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Where a campaign is in its run.
 *
 * `uploaded → previewed → processing → imported`, with `failed` reachable from
 * either working state and recoverable by re-dispatching. `superseded` is
 * terminal and is only ever set on a campaign an **overwrite** replaced — the
 * record is kept rather than deleted, because leads still point at it through
 * `Lead.mailer.campaignId`.
 */
export type MailerCampaignStatus =
  | 'uploaded'
  | 'previewed'
  | 'processing'
  | 'imported'
  | 'failed'
  | 'superseded';

/**
 * What kind of file the campaign was built from.
 *
 * - `vendor` — the stage-2 file the print vendor returns. We run the transform.
 * - `processed` — a file somebody else already processed ("Import a processed
 *   file"): the transform is **skipped** and the upload is imported as-is. This
 *   is the old Add Mailers flow, and the recovery path.
 * - `migration` / `demo` — an *implicit* campaign minted for mailers that
 *   predate campaigns, so `Mailer.campaignId` is never null and history charts
 *   like everything else. Neither is ever created through the API.
 */
export type MailerCampaignSource = 'vendor' | 'processed' | 'migration' | 'demo';

/**
 * How a row's audience is decided.
 *
 * - `carrier_agency_id` — **the default.** The row's own `agencyid` column is
 *   matched against the carrier appointments (PAC-93) under the campaign's
 *   carrier. The file says whose it is; nobody picks. A code no agency holds
 *   blocks the commit rather than being guessed at or silently skipped.
 * - `agencies` — the operator names the agencies; every row is visible to all
 *   of them.
 * - `all` — every agency, **including ones onboarded later**, which is why the
 *   mode is stored rather than an expanded list.
 */
export type MailerAssignmentMode = 'carrier_agency_id' | 'agencies' | 'all';

export interface MailerCampaignAssignment {
  mode: MailerAssignmentMode;
  /** Agency ids. Meaningful only for `agencies`; empty otherwise. */
  agencyIds: string[];
}

// ---------------------------------------------------------------------------
// Settings — the reproducibility snapshot
// ---------------------------------------------------------------------------

/**
 * Everything the transform needed, frozen onto the campaign.
 *
 * The previous run's values are only **defaults that prefill the next one**;
 * what is stored here is what actually ran. There is no separate settings
 * collection, because a rule changed after a run must not retroactively change
 * what that run means.
 *
 * `null` on a `processed` campaign — nothing was transformed.
 */
export interface MailerCampaignSettings {
  /**
   * The minimum offer. Anything the discount table prices below it is raised.
   *
   * ⚠ **Per campaign, never a constant.** The one real run we can inspect
   * (week 29) used $1,886.15 while the app's form default was $1,916.44, and
   * ~95% of rows landed on the floor — for most prospects the offer *is* the
   * floor, and the discount table only prices large, expensive homes.
   */
  premiumFloor: number;
  /** The value written to every row's `FileName` column, e.g. `SFA-QBP`. */
  fileName: string;
  /** Market written when a ZIP is unmapped. Apex hard-codes `Oklahoma City`. */
  defaultMarket: string;
  /** Market → local-presence phone written to `agencyphon`. */
  marketPhones: Record<string, string>;
  /** Phone for any market not in {@link marketPhones}. */
  defaultPhone: string;
  /**
   * The year the run priced against — it drives the home-age discount, so a
   * re-run of a past campaign must carry the original year or every home ages.
   */
  runYear: number;
  discounts: MailerDiscountRules;
  /**
   * ZIP → market resolutions the operator made in the preview, keyed by the
   * 5-digit ZIP.
   *
   * Layered **on top of** the platform `mailerZipMarkets` table at run time and
   * also written back into it, so the next campaign starts with them.
   */
  zipResolutions: Record<string, string>;
  /** Who gets the completion email carrying the output download link. */
  outputRecipients: string[];
}

// ---------------------------------------------------------------------------
// Files, stats, counts
// ---------------------------------------------------------------------------

/**
 * A stored file, as the API describes one.
 *
 * ⚠ **Never carries the storage key.** A key is a capability: the download
 * endpoint mints a short-lived presigned URL on click instead.
 */
export interface MailerCampaignFile {
  name: string;
  size: number;
  sha256?: string;
}

/** The premium spread over `New Yearly Premium 2`, as Apex reports it. */
export interface MailerCampaignPremiumStats {
  min: number;
  max: number;
  avg: number;
  /** Rows with a non-zero premium — the denominator of `avg`. */
  count: number;
}

/**
 * What the transform did.
 *
 * Structurally identical to the processor's own `MailerProcessorStats` so the
 * worker stores it verbatim rather than re-shaping it — a second shape over the
 * same numbers is how a stat on the detail page drifts from the one the run
 * actually produced.
 */
export interface MailerCampaignStats {
  inputRows: number;
  outputRows: number;
  duplicatesRemoved: number;
  /** Rows whose discounted offer fell below the floor and was raised to it. */
  floorRaised: number;
  zipMatched: number;
  /** Rows whose ZIP the market table does not know. */
  zipUnmatched: number;
  /** Rows with no ZIP at all. */
  zipEmpty: number;
  /** `null` when no row carried a usable premium. */
  premium: MailerCampaignPremiumStats | null;
}

/**
 * The import outcome, extending the shared engine's counts with the three
 * things only a campaign commit can report.
 */
export interface MailerCampaignImportCounts extends MailerImportCounts {
  /** Mailers removed because an overwrite's new file did not contain them. */
  deleted: number;
  /** Leads whose pending control-number key this import resolved to a mailer. */
  leadsLinked: number;
  /**
   * Leads that could **not** be linked because the key matched several
   * candidate leads, or because another lead won the mailer first. Reported,
   * never resolved by picking one — an arbitrary link is worse than none.
   */
  leadsConflicted: number;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** One carrier agency code the file carries, and where it resolved to. */
export interface MailerAssignmentResolution {
  /** The uppercased `agencyid`, or `(blank)` for rows carrying none. */
  codeKey: string;
  agencyId: string | null;
  agencyName: string | null;
  rows: number;
}

/** An already-imported campaign this file overlaps. */
export interface MailerCampaignConflict {
  campaignId: string;
  name: string;
  campaignNumber: string | null;
  year: number | null;
  status: MailerCampaignStatus;
  recordCount: number;
}

/**
 * Everything the operator sees **before** anything is written.
 *
 * Produced by the preview worker job and stored on the campaign, so the commit
 * gate can re-verify against the same numbers rather than trusting the request.
 */
export interface MailerCampaignPreview {
  /** Required columns the file is missing. Non-empty ⇒ the campaign failed. */
  missingRequiredColumns: string[];
  /** Recommended columns absent — informational, never blocking. */
  missingRecommendedColumns: string[];
  /** What the transform would produce. `null` on a `processed` source. */
  stats: MailerCampaignStats | null;
  /** 5-digit ZIPs with no market, for the inline resolver. */
  unmatchedZips: string[];
  /** `floorRaised / outputRows`, 0–1. ~0.95 on the real files. */
  floorHitRate: number;
  assignment: {
    resolved: MailerAssignmentResolution[];
    /**
     * Codes matching no agency. **Non-empty blocks the commit** — filing one
     * agency's prospects under another, or dropping them silently, are both
     * worse than refusing.
     */
    unmatched: string[];
  };
  /** Imported/processing campaigns for the same carrier, number and year. */
  existingCampaigns: MailerCampaignConflict[];
  overlap: {
    /** Rows of this file that already exist under some other campaign. */
    existingInOtherCampaigns: number;
    /** Total mailers currently held by the campaigns an overwrite would replace. */
    replacedRecordCount: number;
    /**
     * Exactly how many mailers an overwrite would delete: rows the replaced
     * campaigns hold that this file does **not** contain.
     *
     * Computed here, re-verified at commit against a live count, and asserted
     * again in the delete step. A change between preview and commit is a 409,
     * never a silent proceed.
     */
    deleteCountIfOverwrite: number;
  };
  rejections: MailerImportRejection[];
  /**
   * Columns expected to hold one value across the file that did not.
   *
   * **Informational only.** Several `agencyid` values is the normal multi-agency
   * case, and the real week-36 file carries two `quotedate` values. Rendering
   * this as an error would train operators to click through it.
   */
  inconsistentColumns: string[];
}

// ---------------------------------------------------------------------------
// The campaign itself
// ---------------------------------------------------------------------------

export interface MailerCampaign {
  id: string;
  name: string;
  carrierId: string;
  carrierName: string | null;
  /** Normalized `Week_Number-NN`, kept for the print file and legacy compat. */
  campaignNumber: string | null;
  weekNumber: number | null;
  year: number | null;
  status: MailerCampaignStatus;
  source: MailerCampaignSource;
  assignment: MailerCampaignAssignment;
  /** Distinct `agencyid` values the file carries. Provenance in every mode. */
  carrierAgencyIds: string[];
  /** Distinct `agencyname` values, paired with the above for display. */
  carrierAgencyNames: string[];
  settings: MailerCampaignSettings | null;
  vendorFile: MailerCampaignFile | null;
  outputFile: MailerCampaignFile | null;
  stats: MailerCampaignStats | null;
  preview: MailerCampaignPreview | null;
  importCounts: MailerCampaignImportCounts | null;
  rejections: MailerImportRejection[];
  commitMode: MailerCommitMode | null;
  replaceCampaignIds: string[];
  expectedDeleteCount: number | null;
  /** Present only when `status` is `failed`. */
  error: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  /** Minimum `quotedate` across the file. ISO date string. */
  quoteDate: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  supersededByCampaignId: string | null;
}

/** One row of the campaigns list. */
export interface MailerCampaignListItem {
  id: string;
  name: string;
  campaignNumber: string | null;
  weekNumber: number | null;
  year: number | null;
  status: MailerCampaignStatus;
  source: MailerCampaignSource;
  assignment: MailerCampaignAssignment;
  /** `null` means "all agencies" — not "none". */
  visibleAgencyNames: string[] | null;
  premiumFloor: number | null;
  quoteDate: string | null;
  requestedByName: string | null;
  createdAt: string;
  /** Live count of mailers currently owned by this campaign. */
  recordCount: number;
  /** Leads carrying `mailer.campaignId` equal to this campaign. */
  leadsAttributed: number;
}

/** One mailer in the campaign detail's records table. */
export interface MailerCampaignRecord {
  id: string;
  controlNumber: string | null;
  newControlNumber: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  market: string | null;
  premiumYearly: number | null;
  /** The row's own `agencyid`. */
  carrierAgencyId: string | null;
  /** `null` = visible to every agency. */
  visibleAgencyIds: string[] | null;
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export type MailerCommitMode = 'append' | 'overwrite';

/**
 * `POST /platform/mailer-campaigns/:id/commit`.
 *
 * **Append** upserts: a row already held by an earlier campaign moves to this
 * one (`campaignId`, `visibleAgencyIds` and `carrierAgencyId` are `$set`), the
 * earlier campaign's live count drops, and `Lead.mailer.campaignId` — stamped at
 * link time — is never rewritten. Attribution stays with the campaign that
 * actually produced the lead.
 *
 * **Overwrite** imports *first* and deletes the leftovers afterwards, so rows in
 * both files keep their `_id` and a prospect still being mailed never has a
 * dangling lead link. Only rows the new file does not contain are deleted.
 */
export type MailerCommitRequest =
  | { mode: 'append' }
  | {
      mode: 'overwrite';
      /** Must be a subset of `preview.existingCampaigns`. At least one. */
      replaceCampaignIds: string[];
      /**
       * The operator's acknowledgement of `preview.overlap.deleteCountIfOverwrite`.
       *
       * Echoed back rather than recomputed so a number that moved between
       * preview and commit is a 409 the operator must look at, not a delete
       * they did not agree to.
       */
      expectedDeleteCount: number;
    };

// ---------------------------------------------------------------------------
// ZIP → market
// ---------------------------------------------------------------------------

/**
 * One ZIP → market mapping. Replaces ApexReports' Google Sheet.
 *
 * Platform-global in this ticket: a campaign can serve many agencies, so during
 * a preview no single agency owns the resolution. `agencyId` exists so
 * per-agency overrides are additive later with no migration — the `Carrier`
 * pattern, where `null` is a value meaning "global" and not an absence.
 */
export interface MailerZipMarket {
  id: string;
  /** `null` = platform-global. Nothing writes a non-null value yet. */
  agencyId: string | null;
  zip5: string;
  market: string;
  source: 'seed' | 'preview' | 'manual';
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Lead → mailer attribution
// ---------------------------------------------------------------------------

/**
 * How a lead came to be linked to its mailer. **Never silent** — "which campaign
 * produced this lead" is only trustworthy if the strength of the link is
 * recorded alongside it.
 *
 * - `drawer` — a producer looked the mailer up and pressed Log lead. Certain.
 * - `control_number` — an intake carried a typed control number that resolved
 *   to exactly one mailer, either at write time or when the campaign committed.
 * - `address` — matched on address within a mail window. **Not built here**; the
 *   member exists so the follow-up ticket adds a resolver, not a schema change.
 */
export type LeadMailerMatchedBy = 'drawer' | 'control_number' | 'address';

// ---------------------------------------------------------------------------
// Column contract
// ---------------------------------------------------------------------------

/**
 * Header-normalized columns a vendor file cannot be processed without.
 *
 * Compared against `normalizeHeader(...)` output, so `First Name` and
 * `firstname` are the same column.
 */
export const MAILER_CAMPAIGN_REQUIRED_COLUMNS = [
  'firstname',
  'lastname',
  'address',
  'city',
  'state',
  'zip',
] as const;

/**
 * Columns whose absence degrades the run without stopping it: no `controlno`
 * means no mailer can be looked up, no `yearlyprem` means nothing to discount,
 * no `squarefeet`/`yearbuilt` means no discount band, no `pst_seq` means the
 * presort order is lost. Reported, never enforced.
 */
export const MAILER_CAMPAIGN_RECOMMENDED_COLUMNS = [
  'controlno',
  'yearlyprem',
  'totalpremi',
  'squarefeet',
  'yearbuilt',
  'pstseq',
] as const;

// ---------------------------------------------------------------------------
// List responses
// ---------------------------------------------------------------------------

/**
 * The page shape every platform list uses — `PlatformUserListResponse` is the
 * precedent. Restated per resource rather than made generic because the item
 * type is the interesting half and a `Page<T>` reads worse at every call site.
 */
export interface MailerCampaignListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: MailerCampaignListItem[];
}

export interface MailerCampaignRecordsResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: MailerCampaignRecord[];
}

export interface MailerZipMarketListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: MailerZipMarket[];
}

/**
 * `GET /platform/mailer-campaigns/defaults` — what the Run a campaign form
 * prefills with.
 *
 * The **last imported campaign's** settings, because "last used" is what
 * ApexReports' presets amounted to and what an operator expects; falling back
 * to Apex's own hard-coded values on a platform that has never run one. ⚠ These
 * are defaults only — the campaign stores what actually ran, so editing a rule
 * afterwards never changes what a completed run means.
 */
export interface MailerCampaignDefaults {
  carrierId: string | null;
  carrierName: string | null;
  /** `Week_Number-NN` for today. */
  campaignNumber: string;
  settings: MailerCampaignSettings;
  assignment: MailerCampaignAssignment;
}

/** `GET /platform/mailer-campaigns/:id/files/:kind/url`. */
export interface MailerCampaignFileUrl {
  url: string;
  filename: string;
  /** Seconds the link stays valid, echoed so a UI can say so. */
  expiresIn: number;
}
