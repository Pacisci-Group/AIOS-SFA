/**
 * Quote Recap **edit** contracts (PAC-56 #11).
 *
 * Its own module rather than an addition to `quote-recap.ts`, matching
 * `policy-edit.ts` — the create shape and the edit shape answer different
 * questions and drift for different reasons.
 *
 * ## Why editing exists at all
 *
 * Legacy had a real recap edit form: the SmartSuite Quote Recaps table carried
 * an `Update URL` formula pointing at Fillout form `cusXRDS52ous`. The rebuild
 * shipped create-only, so a producer who fat-fingered a premium had no way to
 * fix it. This is parity work, not a new capability.
 */

import type { StructuredAddress } from './address';
import type {
  LeadDetailQuoteRecap,
  LeadDetailQuoteRecapPolicy,
} from './lead-detail';
import type {
  QuoteDocumentMeta,
  QuoteRecapLeadContext,
  QuoteRecapPolicyInput,
} from './quote-recap';

/**
 * A quoted policy as the **edit form** needs it — the display row plus the one
 * field that is form state rather than display state.
 *
 * `LeadDetailQuoteRecapPolicy` deliberately exposes only the *resolved*
 * address: a row the producer marked "same as household" stores a copy of the
 * household address, not a flag for the reader to re-interpret. That is right
 * for rendering and useless for editing, where the toggle has to come back up
 * in the position the producer left it.
 */
export interface QuoteRecapEditPolicy extends LeadDetailQuoteRecapPolicy {
  sameAsHousehold: boolean;
}

/**
 * `GET /quote-recaps/:id` — everything the edit form needs, in one round trip.
 *
 * Carries `context` verbatim from `GET /quote-recaps/context?leadId=` so the
 * form's `LeadContextHeader` and the "same as household address" toggle work
 * unchanged. The alternative — fetch the recap, learn its `leadId`, then fetch
 * the context — is a request waterfall on a page that cannot render until both
 * have landed.
 */
export interface QuoteRecapEditView {
  id: string;
  /** Byte-identical to what `GET /quote-recaps/context` returns. */
  context: QuoteRecapLeadContext;
  policies: QuoteRecapEditPolicy[];
  /**
   * `null` on a migrated recap, and on any recap created before PAC-56 #16.
   * The edit form treats that as "unset" rather than as a validation failure —
   * see {@link UpdateQuoteRecapInput}.
   */
  insuranceRenewalMonth: string | null;
  notes: string | null;
  /**
   * Metadata only — the storage key never crosses the wire. `null` on a
   * migrated recap that never had a document.
   */
  document: {
    filename: string;
    contentType: string;
    size: number;
    uploadedAt: string;
  } | null;
  /**
   * ISO. **Read-only** — {@link UpdateQuoteRecapInput} cannot move it, because
   * it is the Quoted scorecard's bucket key. Shown so the form says which
   * quote it is amending.
   */
  quoteDate: string | null;
  status: string | null;
  /** Server-derived totals as they stand *before* the edit. */
  premium: number;
  itemCount: number;
  productsQuoted: string[];
  /**
   * The recap-level dwelling that only pre-PAC-56-#14 recaps carry. Read-only
   * and not editable: the form has no field for it, and saving would migrate
   * the recap to per-row addresses anyway.
   */
  legacyPropertyAddress: StructuredAddress | null;
}

/**
 * `PATCH /quote-recaps/:id`. At least one field must be present.
 *
 * Omitted means "leave alone" throughout, matching `UpdatePolicyInput`.
 */
export interface UpdateQuoteRecapInput {
  /**
   * **Full replacement** of the policy list, 1–12 rows — not a per-row patch.
   *
   * `QuotedPolicy` is an `_id: false` sub-document array, so the rows have no
   * identity to address a partial update at, and index-addressing breaks the
   * moment a row is inserted or removed. The form edits the list as a whole and
   * the totals are a fold over all of it regardless.
   */
  policies?: QuoteRecapPolicyInput[];
  /**
   * An `INSURANCE_MONTHS` label (PAC-56 #16).
   *
   * **Optional here even though it is required on create**, and that asymmetry
   * is the point: every migrated recap predates the field, so requiring it on
   * the patch would make all of them un-editable. Same reasoning as
   * `quoteDocument` below. No `null` clear — nothing in the UI expresses
   * "unset the renewal month".
   */
  insuranceRenewalMonth?: string;
  /** `null` clears the notes; omitted leaves them alone. */
  notes?: string | null;
  /**
   * Present replaces the attached document; **omitted keeps the existing one**.
   *
   * `null` is rejected rather than treated as "keep": a recap without its
   * carrier quote is not a legal state (PAC-39 decision 4), so a client that
   * means it should get a 400 instead of a silent no-op.
   *
   * Keeping is the default for a reason beyond convenience — recaps uploaded
   * before PAC-56 #9 may hold a JPEG, which the write path no longer accepts.
   * Re-validating the stored document on every patch would make exactly those
   * records un-editable.
   */
  quoteDocument?: QuoteDocumentMeta;
}

/**
 * The saved recap, in the shape `QuoteRecapCard` already renders — so the web
 * app can splice it straight into the cached `LeadDetail` with no mapping
 * layer, exactly as `UpdatePolicyResult` does.
 */
export type UpdateQuoteRecapResult = LeadDetailQuoteRecap;
