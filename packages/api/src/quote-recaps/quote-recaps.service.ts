import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  QUOTE_ADVANCE_TARGET,
  normalizeLeadStatus,
  quoteAdvanceableStatusValues,
} from '@sfa/shared';
import type {
  AccessContext,
  CreateQuoteRecapResponse,
  DocumentDownloadResponse,
  QuoteDocumentPresignResponse,
  QuoteRecapEditView,
  QuoteRecapLeadContext,
  UpdateQuoteRecapResult,
} from '@sfa/shared';
import { normalizeInsuranceMonth, normalizePolicyType } from '@sfa/shared';
import type { PolicyType } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import {
  normalizeStoredAddress,
  resolveHouseholdAddress,
} from '../common/address/household-address';
import type { StructuredAddress } from '../common/address/household-address';
import { resolvePolicyPropertyAddress } from '../common/address/policy-property-address';
import {
  ChangeFieldSpec,
  ChangeSnapshot,
  changeText,
  diffSnapshots,
  snapshot,
} from '../activities/change-log';
import { roundCents } from '../common/domain/money';
import {
  ResolvedTenantContext,
  TenantContextResolver,
} from '../common/tenancy/tenant-context.resolver';
import { quoteDateYmd } from './quote.normalize';
import { HouseholdDocument } from '../households/schemas/household.schema';
import { LeadAccessService } from '../leads/lead-access.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateQuoteRecapDto } from './dto/create-quote-recap.dto';
import { UpdateQuoteRecapDto } from './dto/update-quote-recap.dto';
import {
  ALLOWED_QUOTE_DOCUMENT_CONTENT_TYPES,
  MAX_QUOTE_DOCUMENT_BYTES,
  PresignQuoteDocumentDto,
} from './dto/presign-quote-document.dto';
import { QuoteRecap, QuoteRecapDocument } from './schemas/quote-recap.schema';

/** Mongo duplicate-key error. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

const ALLOWED_CONTENT_TYPES = new Set<string>(
  ALLOWED_QUOTE_DOCUMENT_CONTENT_TYPES,
);

/**
 * A quoted policy as it is stored on the recap sub-document array.
 *
 * `policyType` is the **narrow** `PolicyType` union, not `string`: that is what
 * `QuotedPolicy` on the schema declares, and widening it here would let an
 * uncatalogued label reach the collection — the second-vocabulary problem the
 * create DTO's `z.enum(POLICY_TYPES)` exists to prevent.
 */
interface StoredQuotedPolicy {
  policyType: PolicyType;
  premium: number;
  itemCount: number;
  propertyAddress?: StructuredAddress;
  sameAsHousehold: boolean;
}

/**
 * A validated policy row, as either DTO produces it.
 *
 * Taken from the zod schema rather than from `QuoteRecapPolicyInput` (whose
 * `policyType` is a plain `string`, since `packages/shared` has no zod
 * dependency): both write paths validate through the same `quotedPolicySchema`,
 * so this is the type that has actually been checked.
 */
type ValidatedPolicyRow = CreateQuoteRecapDto['policies'][number];

/**
 * Resolve the client's rows into what gets stored.
 *
 * Shared by create and update so the two cannot disagree about rounding or
 * about what "same as household" resolves to. Every row that opts in gets its
 * own **copy** of the household address (PAC-56 #14), which is what lets one
 * recap describe a home and a landlord policy on different buildings.
 */
function derivePolicies(
  rows: ValidatedPolicyRow[],
  householdAddress: StructuredAddress | null,
): StoredQuotedPolicy[] {
  return rows.map((row) => {
    const propertyAddress = resolvePolicyPropertyAddress(row, householdAddress);
    return {
      policyType: row.policyType,
      premium: roundCents(row.premium),
      itemCount: row.itemCount,
      propertyAddress,
      sameAsHousehold:
        Boolean(propertyAddress) && row.sameAsHousehold !== false,
    };
  });
}

/**
 * The three recap-level totals, derived from the rows and **never** taken from
 * the client — they back the Quoted scorecard (PAC-10).
 */
function deriveTotals(policies: StoredQuotedPolicy[]) {
  return {
    premium: roundCents(policies.reduce((sum, p) => sum + p.premium, 0)),
    itemCount: policies.reduce((sum, p) => sum + p.itemCount, 0),
    productsQuoted: [...new Set(policies.map((p) => p.policyType))],
  };
}

/**
 * The fields `PATCH /quote-recaps/:id` speaks about in the edit log (PAC-65 #9).
 *
 * Three notes on what is here and what is not:
 *
 * - **The three derived totals are logged; the `policies` rows are not.**
 *   `QuotedPolicy` is an `_id: false` sub-document with no per-row identity, so
 *   the patch replaces the whole array and a positional diff would report every
 *   row as changed on an insert or a reorder. The totals are what the product
 *   owner actually named ("price changes"), they are recomputed server-side, and
 *   `policyCount` carries the shape change the totals alone would hide.
 * - **`quoteDate` / `quoteDateYmd` are absent** because the patch cannot move
 *   them — `quoteDateYmd`'s opportunistic backfill fires on the first touch of
 *   every migrated recap and would report a change nobody made.
 * - **`insuranceRenewalMonth` is normalized on read**, like every other display
 *   of it: migrated recaps hold SmartSuite choice values, and a change row is
 *   never re-normalized once written.
 */
const RECAP_CHANGE_FIELDS: ChangeFieldSpec<QuoteRecapDocument>[] = [
  {
    field: 'premium',
    label: 'Total premium',
    kind: 'currency',
    read: (recap) => recap.premium ?? 0,
  },
  {
    field: 'itemCount',
    label: 'Total items',
    kind: 'number',
    read: (recap) => recap.itemCount ?? 0,
  },
  {
    field: 'productsQuoted',
    label: 'Policy types',
    kind: 'list',
    read: (recap) =>
      (recap.productsQuoted ?? []).map((value) => normalizePolicyType(value)),
  },
  {
    field: 'policyCount',
    label: 'Policy rows',
    kind: 'number',
    read: (recap) => recap.policies?.length ?? 0,
  },
  {
    field: 'insuranceRenewalMonth',
    label: 'Renewal month',
    kind: 'text',
    read: (recap) =>
      recap.insuranceRenewalMonth
        ? normalizeInsuranceMonth(recap.insuranceRenewalMonth)
        : null,
  },
  {
    field: 'notes',
    label: 'Notes',
    kind: 'text',
    read: (recap) => changeText(recap.notes),
  },
  {
    field: 'quoteDocument',
    label: 'Quote document',
    kind: 'text',
    // The filename, never the storage key — that is an internal path the rest
    // of this surface withholds, and a change row is the last place to leak it.
    read: (recap) => recap.quoteDocument?.filename ?? null,
  },
];

/**
 * Quote Recap write path (PAC-39) — the native replacement for the legacy
 * Fillout `quote-recap` webhook.
 *
 * Lead-scoped by design: legacy rejects a recap with no `lead_id` ("Cannot link
 * quote recap to lead"), and a recap that isn't attached to a lead can't be
 * found from the page a producer actually works in. The household is resolved
 * from the lead server-side and never accepted from the client.
 */
@Injectable()
export class QuoteRecapsService {
  private readonly logger = new Logger(QuoteRecapsService.name);

  constructor(
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecapDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly storage: StorageService,
    private readonly leadAccess: LeadAccessService,
  ) {}

  /**
   * The read-only context the form shows on mount, so a producer can confirm
   * they're recapping the right household before entering anything.
   */
  async getLeadContext(
    access: AccessContext,
    branchId: string | null,
    leadId: string,
  ): Promise<QuoteRecapLeadContext> {
    const lead = await this.leadAccess.loadOwnedLead(access, branchId, leadId);
    const household = await this.leadAccess.findHousehold(lead, access);
    return this.buildLeadContext(lead, household);
  }

  /**
   * The lead/household header both the create form and the edit form show.
   *
   * Extracted so `getEditView` returns something byte-identical to
   * `getLeadContext` — the edit page mounts the same `LeadContextHeader` and
   * feeds the same `householdAddress` to the "same as household" toggle, and a
   * second projection would drift from this one silently.
   */
  private buildLeadContext(
    lead: LeadDocument,
    household: HouseholdDocument | null,
  ): QuoteRecapLeadContext {
    return {
      leadId: lead._id.toString(),
      primaryContactName:
        [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() ||
        'Unnamed lead',
      // `null` rather than a 409 here: the form can block up front instead of
      // letting the producer fill everything in and fail at submit.
      householdId: household?._id.toString() ?? null,
      householdName: household?.name ?? null,
      householdAddress: this.householdAddress(lead, household),
      leadStatus: normalizeLeadStatus(lead.status),
    };
  }

  /**
   * Issue a presigned PUT for the quote document.
   *
   * Scoped to the **lead**, not the recap: the document is uploaded while the
   * recap is being composed, so no recap id exists yet. The key that comes back
   * embeds the agency and lead, which is what `create` later verifies.
   */
  async presignQuoteDocument(
    access: AccessContext,
    branchId: string | null,
    dto: PresignQuoteDocumentDto,
  ): Promise<QuoteDocumentPresignResponse> {
    // Ownership first — a presign is a write, and must not leak the existence
    // of another producer's lead.
    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      dto.leadId,
    );

    const key = this.storage.buildObjectKey({
      // From the document, never the request.
      agencyId: lead.agencyId,
      purpose: `quote-recaps/${lead._id.toString()}`,
      filename: dto.filename,
    });

    const presigned = await this.storage.createPresignedUpload(
      key,
      dto.contentType,
    );
    return {
      key: presigned.key,
      uploadUrl: presigned.uploadUrl,
      requiredHeaders: presigned.requiredHeaders,
      expiresIn: presigned.expiresIn,
    };
  }

  /**
   * A short-lived URL that opens the uploaded quote document (PAC-56 #10, #30).
   *
   * Signed **inline**, so following it renders the PDF in the browser's own
   * viewer in a new tab rather than downloading it — the user downloads from
   * there. That is the whole feature: no bespoke viewer, no download button.
   *
   * Gated on `quote_recaps:read` and clamped to the caller's data scope by
   * `assertOwned`, so a producer cannot open a colleague's document by guessing
   * a recap id. The storage key never crosses the wire in either direction.
   */
  async getDocumentDownload(
    access: AccessContext,
    branchId: string | null,
    recapId: string,
  ): Promise<DocumentDownloadResponse> {
    const recap = await this.loadOwnedRecap(access, branchId, recapId);

    const document = recap.quoteDocument;
    if (!document) {
      throw new NotFoundException('This quote recap has no document.');
    }

    const downloadUrl = await this.storage.createPresignedDownload(
      document.key,
      {
        disposition: 'inline',
        filename: document.filename,
        // Overridden explicitly: the object was stored with whatever the
        // browser claimed on upload, and a PDF served as octet-stream
        // downloads instead of rendering however the disposition is set.
        contentType: document.contentType,
      },
    );

    return {
      downloadUrl,
      filename: document.filename,
      contentType: document.contentType,
      expiresIn: this.storage.downloadUrlTtlSeconds,
    };
  }

  /**
   * `GET /quote-recaps/:id` — everything the edit form needs, in one request.
   *
   * Carries the lead/household context alongside the recap so the page can
   * render `LeadContextHeader` and the "same as household address" toggle
   * without a second round trip. Keying the edit route by recap id and then
   * fetching the context by lead id would be a waterfall on a page that cannot
   * paint until both have landed.
   *
   * This is also the **only** surface that exposes `policies[].sameAsHousehold`.
   * `GET /leads/:id` deliberately does not: there the stored row address is
   * already resolved, and re-exposing the flag invites a reader to
   * re-interpret it.
   */
  async getEditView(
    access: AccessContext,
    branchId: string | null,
    recapId: string,
  ): Promise<QuoteRecapEditView> {
    const recap = await this.loadOwnedRecap(access, branchId, recapId);

    if (!recap.leadId) {
      // `LeadDetailService.backfillLeadRef` self-heals this the first time the
      // lead page is viewed, and the Edit button only exists there — so this is
      // a defensive branch rather than an expected one.
      throw new BadRequestException(
        'This quote recap is not linked to a lead yet.',
      );
    }

    // Through `loadOwnedLead`, not a raw lookup, so the lead is scope-clamped
    // on its own terms too.
    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      recap.leadId.toString(),
    );
    const household = await this.leadAccess.findHousehold(lead, access);

    return {
      id: recap._id.toString(),
      context: this.buildLeadContext(lead, household),
      policies: (recap.policies ?? []).map((policy) => ({
        policyType: normalizePolicyType(policy.policyType),
        premium: policy.premium ?? 0,
        itemCount: policy.itemCount ?? 0,
        propertyAddress: normalizeStoredAddress(policy.propertyAddress),
        sameAsHousehold: policy.sameAsHousehold === true,
      })),
      // Normalized on read as well as at migration time, so a database
      // migrated before PAC-56 #16 still yields a month name (see
      // `normalizeInsuranceMonth`). `''` collapses to `null` — the form treats
      // that as unset rather than as invalid.
      insuranceRenewalMonth:
        normalizeInsuranceMonth(recap.insuranceRenewalMonth) || null,
      notes: recap.notes ?? null,
      document: recap.quoteDocument
        ? {
            filename: recap.quoteDocument.filename,
            contentType: recap.quoteDocument.contentType,
            size: recap.quoteDocument.size,
            uploadedAt: recap.quoteDocument.uploadedAt.toISOString(),
          }
        : null,
      quoteDate: recap.quoteDate ? recap.quoteDate.toISOString() : null,
      status: recap.recapStatus ?? null,
      premium: recap.premium ?? 0,
      itemCount: recap.itemCount ?? 0,
      productsQuoted: (recap.productsQuoted ?? [])
        .map((value) => normalizePolicyType(value))
        .filter(Boolean),
      legacyPropertyAddress: normalizeStoredAddress(recap.propertyAddress),
    };
  }

  /**
   * `PATCH /quote-recaps/:id` — correct a recorded quote (PAC-56 #11).
   *
   * Legacy had this (SmartSuite `Update URL` → Fillout `cusXRDS52ous`); the
   * rebuild shipped create-only, so a mistyped premium was permanent.
   *
   * ## What it deliberately does not do
   *
   * **It never moves `quoteDate`.** That is the day the quote was given, and
   * `quoteDateYmd` is the Quoted scorecard's indexed bucket. Re-dating a
   * correction to today would retroactively change a number that has already
   * been reported. It *is* opportunistically backfilled when missing, which
   * self-heals migrated recaps the first time one is touched — the same idiom
   * as `LeadAccessService.findHousehold`.
   *
   * **It does not re-run `advanceLeadStatus`.** PAC-38 made lead status freely
   * editable in both directions so a producer can undo a mis-click; silently
   * re-asserting `Quoted` here would undo a deliberate move back to `Contacted`
   * with nothing on screen to explain it. The advance belongs to the event
   * "a quote was recorded", which happened once.
   *
   * **It does not touch `submissionToken`.** That guards duplicate *creates*;
   * rewriting it would break the create-replay guarantee.
   *
   * **It does not delete the replaced storage object.** `StorageService` has no
   * delete, deliberately — it has never destroyed anything. An orphaned 10 MB
   * PDF is recoverable; a wrongly-deleted document is not, and the abandoned
   * create-form flow already leaves the identical garbage. A bucket lifecycle
   * rule over unreferenced `agencies/*&#47;quote-recaps/**` keys is the right
   * fix, and is a follow-up rather than app code.
   *
   * ## What it does now do: leave a trail (PAC-65 #9)
   *
   * Every edit writes a `field_changed` activity, readable only by holders of
   * `agency:changelogs:read` — owners and managers. The product owner was
   * explicit that editing stays open (users complain about friction) and that
   * the answer to the transparency concern is a log rather than a lock, with
   * price changes the case he named.
   */
  async update(
    access: AccessContext,
    branchId: string | null,
    recapId: string,
    dto: UpdateQuoteRecapDto,
  ): Promise<UpdateQuoteRecapResult> {
    const recap = await this.loadOwnedRecap(access, branchId, recapId);

    if (!recap.leadId) {
      throw new BadRequestException(
        'This quote recap is not linked to a lead yet.',
      );
    }

    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      recap.leadId.toString(),
    );

    // Before anything is assigned — `deriveTotals` below overwrites `premium`,
    // `itemCount` and `productsQuoted` in place, so there is no reading them
    // back afterwards.
    const before = snapshot(RECAP_CHANGE_FIELDS, recap);

    if (dto.policies) {
      const household = await this.leadAccess.findHousehold(lead, access);
      const policies = derivePolicies(
        dto.policies,
        this.householdAddress(lead, household),
      );
      recap.policies = policies;
      Object.assign(recap, deriveTotals(policies));
    }

    if (dto.insuranceRenewalMonth !== undefined) {
      recap.insuranceRenewalMonth = dto.insuranceRenewalMonth;
    }

    if (dto.notes !== undefined) {
      recap.notes = dto.notes ?? undefined;
    }

    if (dto.quoteDocument) {
      // Same verification the create path runs: the key must live under this
      // agency and lead, and the type/size come from `HeadObject` rather than
      // from the client's claim.
      this.storage.assertKeyOwnership(dto.quoteDocument.key, {
        agencyId: recap.agencyId,
        purpose: `quote-recaps/${recap.leadId.toString()}`,
      });
      const stored = await this.verifyQuoteDocument(dto.quoteDocument.key);
      recap.quoteDocument = {
        key: dto.quoteDocument.key,
        filename: dto.quoteDocument.filename,
        contentType: stored.contentType,
        size: stored.size,
        uploadedAt: new Date(),
      };
    }

    // Opportunistic, never recomputed — see the docblock.
    if (recap.quoteDate && recap.quoteDateYmd == null) {
      recap.quoteDateYmd = quoteDateYmd(recap.quoteDate);
    }

    await recap.save();

    // Best-effort and post-commit, like the create path's follow-ups: the Leads
    // list sorts on `lastActivityAt`, and an edit is activity.
    try {
      await this.leadModel.updateOne(
        { _id: lead._id },
        { $set: { lastActivityAt: new Date() } },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to bump lastActivityAt for lead ${lead._id.toString()}: ${String(error)}`,
      );
    }

    await this.recordFieldChanges(access, recap, lead._id, before);

    return this.toLeadDetailQuoteRecap(recap);
  }

  /**
   * The edit log entry for `PATCH /quote-recaps/:id` (PAC-65 #9).
   *
   * Post-commit and best-effort, matching every other follow-up on this path —
   * the correction is what the producer asked for, and failing the request
   * after it committed would report the wrong outcome. But `logger.error`, not
   * `warn`: a dropped row is a hole in an audit trail, which is worth an alert
   * in a way a stale sort key is not.
   *
   * `branchId` comes off the recap rather than a tenant resolve. It is
   * `required: true` on `TenantRecord`, so a missing one throws *inside* this
   * try/catch and silently loses the row.
   */
  private async recordFieldChanges(
    access: AccessContext,
    recap: QuoteRecapDocument,
    leadId: Types.ObjectId,
    before: ChangeSnapshot,
  ): Promise<void> {
    const changes = diffSnapshots(
      RECAP_CHANGE_FIELDS,
      before,
      snapshot(RECAP_CHANGE_FIELDS, recap),
    );
    // A patch that set every field to what it already held. Nothing happened,
    // so the timeline should not claim otherwise.
    if (!changes.length) return;

    try {
      await this.activityModel.create({
        agencyId: recap.agencyId,
        branchId: recap.branchId,
        type: 'field_changed',
        subjectType: 'quoteRecap',
        leadId,
        quoteRecapId: recap._id,
        userId: new Types.ObjectId(access.userId),
        occurredAt: new Date(),
        // Deliberately value-free — see the `summary` docblock on the schema.
        // `HotLeadsService` renders the newest activity's summary onto the
        // producer's own dashboard, so the values live in `changes` alone.
        summary: 'Quote recap edited',
        // Explicit: `source` defaults to 'migration', and `toActivityOrigin`
        // maps that to the "Imported" chip.
        source: 'internal',
        isTestRecord: false,
        changes,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record the edit log for quote recap ${recap._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Load a recap the caller is allowed to see, or 404.
   *
   * **404, never 403, in every direction** — a malformed id, a missing recap,
   * another agency's recap and another producer's recap are deliberately
   * indistinguishable, matching `LeadAccessService.loadOwnedLead` and
   * `PoliciesService.loadOwnedPolicy`. A 403 would confirm the record exists.
   */
  private async loadOwnedRecap(
    access: AccessContext,
    branchId: string | null,
    recapId: string,
  ): Promise<QuoteRecapDocument> {
    if (!Types.ObjectId.isValid(recapId)) {
      throw new NotFoundException('Quote recap not found.');
    }

    const recap = await this.quoteRecapModel.findOne({
      _id: new Types.ObjectId(recapId),
      agencyId: access.agencyId,
    });
    if (!recap) throw new NotFoundException('Quote recap not found.');

    this.leadAccess.assertOwned(recap, access, branchId);
    return recap;
  }

  /**
   * The saved recap in the shape `GET /leads/:id` returns, so the web app can
   * splice it straight into the cached `LeadDetail`.
   *
   * `producerName` is looked up rather than taken from the caller: the editor
   * and the original author are not always the same person, and the card
   * attributes the *notes*, which belong to whoever recorded the recap.
   */
  private async toLeadDetailQuoteRecap(
    recap: QuoteRecapDocument,
  ): Promise<UpdateQuoteRecapResult> {
    const policies = recap.policies ?? [];
    const producer = recap.producerId
      ? await this.userModel
          .findById(recap.producerId)
          .select('firstName lastName')
      : null;
    const producerName = producer
      ? [producer.firstName, producer.lastName].filter(Boolean).join(' ').trim()
      : '';

    return {
      id: recap._id.toString(),
      quoteDate: recap.quoteDate ? recap.quoteDate.toISOString() : null,
      premium: recap.premium ?? 0,
      itemCount: recap.itemCount ?? 0,
      productsQuoted: (recap.productsQuoted ?? [])
        .map((value) => normalizePolicyType(value))
        .filter(Boolean),
      status: recap.recapStatus ?? null,
      producerName: producerName || null,
      createdAt: recap.createdAt ? recap.createdAt.toISOString() : null,
      policies: policies.map((policy) => ({
        policyType: normalizePolicyType(policy.policyType),
        premium: policy.premium ?? 0,
        itemCount: policy.itemCount ?? 0,
        propertyAddress: normalizeStoredAddress(policy.propertyAddress),
      })),
      propertyAddress: normalizeStoredAddress(recap.propertyAddress),
      insuranceRenewalMonth:
        normalizeInsuranceMonth(recap.insuranceRenewalMonth) || null,
      notes: recap.notes ?? null,
      document: recap.quoteDocument
        ? {
            filename: recap.quoteDocument.filename,
            contentType: recap.quoteDocument.contentType,
            size: recap.quoteDocument.size,
            uploadedAt: recap.quoteDocument.uploadedAt.toISOString(),
          }
        : null,
    };
  }

  async create(
    access: AccessContext,
    branchId: string | null,
    dto: CreateQuoteRecapDto,
  ): Promise<CreateQuoteRecapResponse> {
    const tenant = await this.tenancy.resolve(access, branchId);
    const token = this.buildSubmissionToken(dto.submissionToken);

    // Probe before doing any work, the same reasoning as lead intake: a replay
    // should not re-run household resolution or re-verify storage.
    if (token) {
      const replay = await this.quoteRecapModel.findOne({
        agencyId: tenant.agencyId,
        submissionToken: token,
      });
      if (replay) {
        // Clamp the *found* recap, so a token replayed by another producer 404s
        // rather than handing back someone else's id.
        this.leadAccess.assertOwned(replay, access, branchId);
        const leadStatus = await this.advanceLeadStatus(replay.leadId, tenant);
        return this.toResponse(replay, leadStatus);
      }
    }

    const lead = await this.leadAccess.loadOwnedLead(
      access,
      branchId,
      dto.leadId,
    );
    const household = await this.leadAccess.resolveHousehold(lead, access);

    this.storage.assertKeyOwnership(dto.quoteDocument.key, {
      agencyId: tenant.agencyId,
      purpose: `quote-recaps/${lead._id.toString()}`,
    });
    const stored = await this.verifyQuoteDocument(dto.quoteDocument.key);

    // Resolved once: every row that says "same as household" copies this, so a
    // recap covering a home and a landlord policy ends up with two rows whose
    // addresses are independently correct (PAC-56 #14).
    const householdAddress = this.householdAddress(lead, household);
    const policies = derivePolicies(dto.policies, householdAddress);
    const quoteDate = new Date();

    try {
      const recap = await this.quoteRecapModel.create({
        agencyId: tenant.agencyId,
        branchId: tenant.branchId,
        title: household.name ? `${household.name} — Quote` : 'Quote',
        quoteDate,
        // The indexed calendar-day label the Quoted scorecard buckets by
        // (PAC-10). Derived here rather than at read time so the scorecard is a
        // plain integer range — the same reason `Deal.soldDateYmd` is persisted.
        quoteDateYmd: quoteDateYmd(quoteDate),
        // Derived server-side and never taken from the client: these three back
        // the Quoted scorecard, so a client-supplied total would corrupt it.
        ...deriveTotals(policies),
        recapStatus: 'Submitted',
        producerId: new Types.ObjectId(access.userId),
        leadId: lead._id,
        householdId: household._id,
        policies,
        // No recap-level `propertyAddress`/`sameAsHousehold`: since PAC-56 #14
        // the dwelling belongs to the policy row, and those two fields exist
        // only for the recaps written before that.
        //
        // The renewal month, however, *is* recap-level — one client, one
        // current policy renewing (PAC-56 #16, matching legacy's shape).
        insuranceRenewalMonth: dto.insuranceRenewalMonth,
        notes: dto.notes,
        quoteDocument: {
          key: dto.quoteDocument.key,
          filename: dto.quoteDocument.filename,
          // From storage, not from the client's claim.
          contentType: stored.contentType,
          size: stored.size,
          uploadedAt: quoteDate,
        },
        submissionToken: token ?? undefined,
        isTestRecord: false,
      });

      // Both follow-ups are best-effort and post-commit. The recap is the only
      // irreplaceable thing in this request; rolling it back because a timeline
      // row failed would fail in the wrong direction.
      const leadStatus = await this.advanceLeadStatus(lead._id, tenant);
      await this.recordQuotedActivity(recap, tenant);

      return this.toResponse(recap, leadStatus);
    } catch (error) {
      // Two in-flight requests with the same token: the loser sees E11000 on
      // the unique `{agencyId, submissionToken}` index. Re-reading here is what
      // makes "a double-submit creates one recap" true under real concurrency
      // rather than only for a sequential retry.
      if (isDuplicateKeyError(error) && token) {
        const winner = await this.quoteRecapModel.findOne({
          agencyId: tenant.agencyId,
          submissionToken: token,
        });
        if (winner) {
          // Re-derive rather than reusing the now-stale in-memory lead: the
          // winning request advanced it. `advanceLeadStatus` is idempotent.
          const leadStatus = await this.advanceLeadStatus(lead._id, tenant);
          return this.toResponse(winner, leadStatus);
        }
      }
      throw error;
    }
  }

  private householdAddress(
    lead: LeadDocument,
    household: HouseholdDocument | null,
  ): StructuredAddress | null {
    return resolveHouseholdAddress(
      lead.address,
      household?.propertyAddress,
      household?.mailingAddress,
    );
  }

  /**
   * Verify the upload actually landed, and take its real type and size.
   *
   * The presigned PUT signs only the content type, so nothing stops a caller
   * uploading a 5 GB file against a valid URL — the declared `size` in the body
   * is a claim, not evidence. This is what makes the type/size limits
   * server-side rather than advisory.
   */
  private async verifyQuoteDocument(
    key: string,
  ): Promise<{ contentType: string; size: number }> {
    const stored = await this.storage.statObject(key);
    if (!stored) {
      throw new NotFoundException(
        'Uploaded document was not found in storage.',
      );
    }
    if (stored.size > MAX_QUOTE_DOCUMENT_BYTES) {
      throw new BadRequestException('Quote document is larger than 10MB.');
    }
    if (!stored.contentType || !ALLOWED_CONTENT_TYPES.has(stored.contentType)) {
      throw new BadRequestException('Quote document must be a PDF.');
    }
    return { contentType: stored.contentType, size: stored.size };
  }

  /**
   * Move the lead to "Quoted", forward only.
   *
   * One atomic conditional update: the forward-only rule is a database-level
   * invariant rather than a read-then-write race. `lastActivityAt` moves too,
   * because the Leads list sorts on it and a lead you just quoted should not
   * sink below untouched ones.
   *
   * Best-effort — the recap is already committed by the time this runs, and it
   * is idempotent, so the replay path re-runs it to self-heal a create whose
   * follow-up died.
   */
  private async advanceLeadStatus(
    leadId: Types.ObjectId | undefined,
    tenant: ResolvedTenantContext,
  ): Promise<string> {
    if (!leadId) return QUOTE_ADVANCE_TARGET;
    try {
      const advanced = await this.leadModel.findOneAndUpdate(
        {
          _id: leadId,
          agencyId: tenant.agencyId,
          status: { $in: quoteAdvanceableStatusValues() },
        },
        {
          $set: {
            status: QUOTE_ADVANCE_TARGET,
            lastActivityAt: new Date(),
          },
        },
        { new: true, projection: { status: 1 } },
      );
      if (advanced) return normalizeLeadStatus(advanced.status);

      // No match means the lead is already Quoted or terminal — one extra read
      // to report what it actually is, only on that branch.
      const current = await this.leadModel.findById(leadId).select('status');
      return normalizeLeadStatus(current?.status);
    } catch (error) {
      this.logger.error(
        `Failed to advance status for lead ${leadId.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
      return QUOTE_ADVANCE_TARGET;
    }
  }

  /** Timeline entry, matching what the migration writes for a migrated recap. */
  private async recordQuotedActivity(
    recap: QuoteRecapDocument,
    tenant: ResolvedTenantContext,
  ): Promise<void> {
    try {
      await this.activityModel.create({
        agencyId: tenant.agencyId,
        branchId: tenant.branchId,
        type: 'quoted',
        subjectType: 'quoteRecap',
        leadId: recap.leadId,
        quoteRecapId: recap._id,
        userId: recap.producerId,
        occurredAt: recap.quoteDate,
        summary: 'Quote recap created',
        // Explicit: `source` defaults to 'migration', so omitting it would label
        // an app-created activity as migrated.
        source: 'internal',
        isTestRecord: false,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record quoted activity for recap ${recap._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** `WEB|<UPPERCASED>`, matching the lead-intake namespacing convention. */
  private buildSubmissionToken(raw?: string | null): string | null {
    const token = raw?.trim();
    return token ? `WEB|${token.toUpperCase()}` : null;
  }

  private toResponse(
    recap: QuoteRecapDocument,
    leadStatus: string,
  ): CreateQuoteRecapResponse {
    return {
      id: recap._id.toString(),
      leadId: recap.leadId?.toString() ?? '',
      premium: recap.premium,
      itemCount: recap.itemCount,
      productsQuoted: recap.productsQuoted,
      quoteDate: (recap.quoteDate ?? new Date()).toISOString(),
      leadStatus,
    };
  }
}
