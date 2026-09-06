import type { MailerSourceSystem } from '@sfa/shared';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, IndexOptions } from 'mongoose';

export type MailerDocument = HydratedDocument<Mailer>;

/**
 * Where the mail piece was sent.
 *
 * `county` is a **string** on purpose: the source ships a zero-padded FIPS code
 * (`'017'`), and `Number()` destroys the padding. Rendering it as a county name
 * is the reader's job (PAC-61), not the importer's.
 */
@Schema({ _id: false })
export class MailerAddress {
  @Prop({ trim: true }) street?: string;
  @Prop({ trim: true }) city?: string;
  @Prop({ trim: true }) state?: string;
  /** Full ZIP+4 as printed, e.g. `74003-5807`. */
  @Prop({ trim: true }) zip?: string;
  /** The 5-digit half, split out so a zip lookup stays exact. */
  @Prop({ trim: true }) zip5?: string;
  /** The +4 half. */
  @Prop({ trim: true }) zip4?: string;
  /** Zero-padded FIPS county code. See the class note. */
  @Prop({ trim: true }) county?: string;
}
export const MailerAddressSchema = SchemaFactory.createForClass(MailerAddress);

/**
 * The quoted coverage the prospect actually received, so a producer can read it
 * back on the call.
 *
 * `otherStructures` and `lossOfUse` are each 10% of `dwelling` in the source
 * data, but they are stored rather than derived — the relationship is a
 * property of one carrier's rating, not a rule we should bake in.
 */
@Schema({ _id: false })
export class MailerCoverage {
  /** Coverage A — `dwellingli`. */
  @Prop() dwelling?: number;
  /** Coverage B — `otherlimit`. */
  @Prop() otherStructures?: number;
  /** Coverage D — `livingexpl`. */
  @Prop() lossOfUse?: number;
  /** `guestlimit`. */
  @Prop() guestMedical?: number;
  /** `familylimi`. */
  @Prop() familyLiability?: number;
}
export const MailerCoverageSchema =
  SchemaFactory.createForClass(MailerCoverage);

/**
 * Every premium figure the source carries, stored side by side and labelled
 * literally.
 *
 * ⚠ **These are not restatements of one number.** Measured across all 20,405
 * rows of the reference file: `yearly` equals `monthly × 12` on 19,946 rows and
 * `newYearly` on 20,402 — but it **never** equals `total` on a single row, and
 * the ratio between them spans 0.46–2.95. Which figure a producer should quote
 * is an open question for the product owner (PAC-61 open item 1). Until it is
 * answered nothing may present one of these as "our quote", because a wrong
 * label misquotes a live prospect.
 */
@Schema({ _id: false })
export class MailerPremium {
  /** `totalpremi` — straight from the source file, untouched by the pipeline. */
  @Prop() total?: number;
  /** `yearlyprem` — the mailed offer, formatted `"$1886.15/year*"` at source. */
  @Prop() yearly?: number;
  /** `monthlypre` — a bare decimal at source, unlike its siblings. */
  @Prop() monthly?: number;
  /** `New Yearly Premium 2` — the pipeline's recomputed annual figure. */
  @Prop() newYearly?: number;
}
export const MailerPremiumSchema = SchemaFactory.createForClass(MailerPremium);

/**
 * The campaign columns **the source row carries**, kept verbatim.
 *
 * ⚠ Not to be confused with `MailerCampaign` in `mailer-campaign.schema.ts`,
 * which is the first-class campaign record {@link Mailer.campaignId} points at.
 * This block is provenance read off the file; that one is the run we performed.
 * The `Info` suffix exists purely to keep the two apart in one import list.
 *
 * ⚠ `campaignNumber` is **not a campaign id.** Every value is `Week_Number-NN`,
 * a restatement of the week number — 37 distinct values across 671k legacy
 * rows. `mailDropDate`, `startMon`, `endSun` and `campaignStatus` exist only in
 * BigQuery and are absent from a vendor file; they are optional for exactly
 * that reason and must never be treated as required.
 */
@Schema({ _id: false })
export class MailerCampaignInfo {
  @Prop({ trim: true }) campaignNumber?: string;
  /** Derived from `campaignNumber` when the source does not carry it directly. */
  @Prop() weekNumber?: number;
  /** The pipeline's `FileName`, e.g. `SFA-20P`. Its prefix is the agency ticker. */
  @Prop({ trim: true }) fileName?: string;
  /** `type`, e.g. `Home`. */
  @Prop({ trim: true }) policyType?: string;
  /** `product`, e.g. `FQ`. */
  @Prop({ trim: true }) product?: string;
  /** `quotestatu`, a single-valued passthrough in every file seen so far. */
  @Prop({ trim: true }) quoteStatus?: string;

  // --- BigQuery-only, null on an uploaded mailer -----------------------------
  @Prop({ type: Date }) mailDropDate?: Date;
  @Prop({ type: Date }) startMon?: Date;
  @Prop({ type: Date }) endSun?: Date;
  /** `Active` / `Closed` / absent. Never fabricate this for an upload. */
  @Prop({ trim: true }) campaignStatus?: string;
}
export const MailerCampaignInfoSchema =
  SchemaFactory.createForClass(MailerCampaignInfo);

/**
 * Provenance, deliberately source-agnostic so the RTP upload and the BigQuery
 * backfill share it with no branching.
 */
@Schema({ _id: false })
export class MailerSource {
  /**
   * ⚠ Needs an explicit `type: String`. `MailerSourceSystem` is a union, and
   * `@nestjs/mongoose` reflects the *design-time* type — a union reflects as
   * `Object`, which throws at schema construction. The build does not catch it
   * because the decorator only runs when the module is imported.
   */
  @Prop({
    required: true,
    trim: true,
    type: String,
    enum: ['bigquery', 'spreadsheet'],
  })
  system: MailerSourceSystem;
  /** The pipeline's `FileName` (`SFA-20P`), echoed for provenance. */
  @Prop({ trim: true }) fileName?: string;
  /** The name the operator's browser sent, e.g. `SFA-RTP-2026-29.csv`. */
  @Prop({ trim: true }) uploadedFilename?: string;
  /**
   * Object-storage key of the raw upload.
   *
   * The only way to re-import after a mapping bug, which is why the file is
   * retained rather than discarded once parsed.
   */
  @Prop({ trim: true }) storageKey?: string;
  /** `<campaignId>:<commitAttempt>`, or an offline backfill's run stamp. */
  @Prop({ trim: true }) runId?: string;
  @Prop({ type: Date }) uploadedAt?: Date;
  /** BigQuery's `last_updated`; the tiebreak when duplicates collapse. */
  @Prop({ type: Date }) lastUpdatedAt?: Date;
  /** User id of the operator who committed the import. */
  @Prop({ trim: true }) updatedBy?: string;
  /**
   * Free-form marker for rows written by something other than a real import.
   *
   * The demo seed writes `demo:seed` here and purges on it — `Mailer` has no
   * `legacySmartSuiteId`, so it cannot use the `demo:*` key every other demo
   * collection keys on. Same exception `ProducerGoal` already makes.
   */
  @Prop({ trim: true }) recordSource?: string;
  /**
   * The untransformed source row.
   *
   * Holds every column not modelled above — the single-valued passthroughs
   * (`deductible`, `windhail`, `roofsurfac`, …), the duplicate `coveragest`,
   * and the 33 columns that are empty in a Home file but populated in an Auto
   * one. Makes a bad coercion recoverable without re-importing.
   */
  @Prop({ type: Object }) raw?: Record<string, unknown>;
}
export const MailerSourceSchema = SchemaFactory.createForClass(MailerSource);

/**
 * One direct-mail prospect record (PAC-73).
 *
 * ## Why this does not extend `TenantRecord`
 *
 * `TenantRecord.branchId` is `required: true` and a mailer has **no branch
 * dimension** — a campaign is bought by an agency, not by one of its offices.
 * `Carrier` and `Agency` are the precedent for an agency-scoped, non-branch
 * collection.
 *
 * ## Why there is no `legacySmartSuiteId`
 *
 * Mailers never lived in SmartSuite. They came from BigQuery and, going
 * forward, from an uploaded file — so the `LEGACY_DEDUPE_INDEX_OPTIONS` index
 * every migrated collection carries would key on a field nothing ever writes.
 * Its absence is deliberate, not an oversight. Dedupe happens on
 * {@link controlNumberKeys} instead.
 *
 * ## Tenancy lives on the campaign, not on the mailer (PAC-71)
 *
 * A mailer has **no `agencyId`**. It belongs to a {@link campaignId}, and a
 * campaign is run once and can serve many agencies — a file whose `agencyid`
 * column carries two carrier agency codes splits across two tenants without
 * being uploaded twice. Who may see the row is {@link visibleAgencyIds},
 * resolved per row from the campaign's assignment mode.
 *
 * The lead a mailer produces is still created in the **caller's** agency. Only
 * the mailer's visibility is multi-tenant.
 */
@Schema({ timestamps: true, collection: 'mailers' })
export class Mailer {
  /**
   * The `mailerCampaigns` document this row was written by. Required — every
   * mailer belongs to a run, including the implicit campaigns the PAC-71
   * backfill mints for rows that predate campaigns.
   *
   * A **string**, not an `ObjectId`, to match how every id is threaded through
   * the import engine (which is model-agnostic by design) and how
   * `Lead.mailer.campaignId` denormalizes it.
   */
  @Prop({ required: true, index: true })
  campaignId: string;

  /**
   * The agencies this row is visible to. `null` means **every agency**,
   * including ones onboarded later.
   *
   * ⚠ Two traps, both load-bearing.
   *
   * 1. **Query it with `{ $type: 'null' }`, never `null`.** A bare `null` also
   *    matches a *missing* field, so any mailer a migration has not yet reached
   *    would read as visible to every tenant.
   * 2. **`type: [String]` with `default: null`.** Mongoose defaults an array
   *    prop to `[]`, and `[]` means "visible to nobody" — the opposite. The
   *    importer writes through `bulkWrite`, which bypasses casting and stores
   *    the literal `null` regardless, so the two write paths would otherwise
   *    disagree about what the same field means.
   */
  @Prop({ type: [String], default: null })
  visibleAgencyIds: string[] | null;

  /**
   * The row's own `agencyid` column, uppercased — the **carrier's** code for the
   * issuing agency (`A0B9049`), not one of our agency ids.
   *
   * Provenance in every assignment mode, and the routing key in
   * `carrier_agency_id` mode, where it is matched against the carrier
   * appointments (PAC-93) under the campaign's carrier.
   */
  @Prop({ trim: true, uppercase: true })
  carrierAgencyId?: string;

  /** `controlno` — `#` followed by a UUID. */
  @Prop({ trim: true })
  controlNumber?: string;

  /** `New Control Number` — the last 12 hex characters of that UUID. */
  @Prop({ trim: true })
  newControlNumber?: string;

  /**
   * Both control-number forms, normalized, in one multikey-indexed array.
   *
   * A producer types whichever number is printed on the mail piece, and the two
   * forms are genuinely different strings (they differ on 671,339/671,339
   * legacy rows) — legacy papered over that with `ENDS_WITH`/`CONTAINS_SUBSTR`
   * substring matching. Storing both normalized answers "match either form"
   * with **one** index instead of two plus an `$or`, and keeps the lookup
   * index-backed rather than a collection scan. Same stored-normalized-key
   * approach as `Policy.policyNumberKey`.
   */
  @Prop({ type: [String], default: [] })
  controlNumberKeys: string[];

  @Prop({ trim: true }) firstName?: string;
  @Prop({ trim: true }) lastName?: string;
  @Prop({ trim: true }) fullName?: string;
  @Prop({ trim: true }) gender?: string;

  /**
   * ⚠ Empty on 100% of rows in the reference file, as is `dateOfBirth`;
   * `phone` is populated on 4.4%. Anything consuming a mailer must render
   * cleanly with none of the three — which is also why the log-lead endpoint
   * cannot reuse `create-lead.dto.ts` (PAC-61).
   */
  @Prop({ trim: true }) email?: string;
  @Prop({ trim: true }) phone?: string;
  @Prop({ type: Date }) dateOfBirth?: Date;

  @Prop({ type: MailerAddressSchema }) address?: MailerAddress;
  @Prop() squareFeet?: number;
  @Prop() yearBuilt?: number;

  @Prop({ type: MailerCoverageSchema }) coverage?: MailerCoverage;
  @Prop({ type: MailerPremiumSchema }) premium?: MailerPremium;
  @Prop({ type: MailerCampaignInfoSchema }) campaign?: MailerCampaignInfo;
  @Prop({ type: Date }) quoteDate?: Date;

  /**
   * The market the piece was mailed into (`Right_Name`), e.g. `Tulsa`.
   *
   * Pairs exactly with {@link agencyPhone} — each market has its own
   * local-presence number.
   */
  @Prop({ trim: true }) market?: string;

  /**
   * Local-presence dial number so the mail piece looks local to the recipient.
   *
   * ⚠ **Display and provenance only — this is not tenant identity.** It is
   * dynamic and shared across agencies; two values partition the reference file
   * by market. Never resolve an agency from it.
   */
  @Prop({ trim: true }) agencyPhone?: string;

  /**
   * Suppression flags carried through from the source.
   *
   * Not a display nicety: a producer cold-calling a suppressed record is a
   * real-world compliance problem. 195 rows of the reference file are
   * `doNotMail`, 18 of which have a phone number.
   */
  @Prop({ default: false }) doNotCall: boolean;
  @Prop({ default: false, index: true }) doNotMail: boolean;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;

  @Prop({ type: MailerSourceSchema, required: true })
  source: MailerSource;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MailerSchema = SchemaFactory.createForClass(Mailer);

/**
 * The dedupe key, and the lookup PAC-61's drawer runs on every keystroke.
 *
 * ## Platform-wide since PAC-71
 *
 * It used to be `{ agencyId, controlNumberKeys }`. A control number is a UUID
 * and **one mailer exists once on the platform**: the same row reaching two
 * agencies is one prospect visible to both, not two prospects. Making the key
 * agency-prefixed would let one campaign's row be duplicated per audience,
 * which then makes "which lead worked this mailer" unanswerable.
 *
 * `unique` is safe because every writer upserts on this key, so duplicate
 * source rows — BigQuery has 30,991 of them — collapse before the index sees a
 * conflict. (Contrast `Policy.policyNumberKey`, non-unique on purpose because
 * carriers reuse numbers.)
 *
 * `partialFilterExpression`, **never** `sparse`, per the house rule on
 * `LEGACY_DEDUPE_INDEX_OPTIONS`. It is what keeps control-number-less rows out
 * of the index entirely rather than colliding on `null`.
 *
 * ⚠ The three constants are exported because the PAC-71 backfill creates this
 * index itself, *before* the schema's `autoIndex` can. A restated, drifted copy
 * there would make the next boot throw `IndexOptionsConflict`.
 */
export const MAILER_DEDUPE_INDEX_NAME = 'controlNumberKeys_1';
export const MAILER_DEDUPE_INDEX_KEY = { controlNumberKeys: 1 } as const;
export const MAILER_DEDUPE_INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: { controlNumberKeys: { $type: 'string' } },
} satisfies IndexOptions;

MailerSchema.index(MAILER_DEDUPE_INDEX_KEY, {
  name: MAILER_DEDUPE_INDEX_NAME,
  ...MAILER_DEDUPE_INDEX_OPTIONS,
});

/**
 * The campaign detail's records table: count, and the last/first name sort.
 *
 * Replaces the four `agencyId_*` indexes, which the PAC-71 backfill drops —
 * nothing queries mailers by agency any more.
 */
MailerSchema.index({ campaignId: 1, lastName: 1, firstName: 1 });

/** Backs "everything this run wrote", for a re-run or a rollback. */
MailerSchema.index({ campaignId: 1, 'source.runId': 1 });

/*
 * There is deliberately **no index on `visibleAgencyIds`.** The drawer's lookup
 * leads with `controlNumberKeys`, whose unique index resolves to at most one
 * document; the visibility `$or` is then a residual filter over that single
 * FETCH. A compound of `controlNumberKeys` and `visibleAgencyIds` is not even
 * buildable — MongoDB refuses a compound index over two array fields.
 */
