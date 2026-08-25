/**
 * Sold Deal wire contracts (PAC-40) — shared by the NestJS write path and the
 * `/sold/new` wizard.
 *
 * Deliberately plain TypeScript, for the reason given in `lead-intake.ts`: zod
 * is not a dependency of this package. The API validates with its own zod DTO
 * (`dto/create-sold-deal.dto.ts`) and the web app with its own
 * (`features/sold/components/sold-deal-schema.ts`); these interfaces are what
 * both agree the shape is.
 */

import type { StructuredAddress } from './address';

/**
 * A document already uploaded to storage via presigned PUT. The client sends
 * the `key` it was issued; the server re-derives `contentType` and `size` from
 * the stored object and ignores the declared values.
 */
export interface SoldDocumentMeta {
  key: string;
  filename: string;
  contentType: string;
  size: number;
}

/**
 * A discount that can be evidenced.
 *
 * ⚠ **The document is optional** (PAC-65, reversing PAC-56 #21). Ticking the
 * box generates the audit item either way — David: *"even if the details are
 * provided, you're still gonna audit it because we have to make sure."* So the
 * upload is never the gate; it only changes how much work the audit is. With a
 * document the auditor verifies what is in front of them; without one the item
 * tells them to call the client and obtain it.
 *
 * That is why there is no `hasProof` flag: `selected && !attachment` **is** the
 * "no proof, go and chase it" state. A stored boolean saying the same thing
 * could disagree with the attachment, and then two code paths disagree about
 * what happened.
 */
export interface ProofBackedDiscount {
  selected: boolean;
  /** Optional — see the note above. Its absence is meaningful, not an error. */
  attachment?: SoldDocumentMeta;
}

/** A driver named on the Defensive Driver discount. */
export interface DefensiveDriverSelection {
  /** Display name, used as the audit item's subject so N items stay distinct. */
  name: string;
  /** Set when the driver was picked from the household rather than typed. */
  contactId?: string;
  /**
   * That driver's certificate. **Optional** since PAC-65 — naming the driver is
   * still required, their certificate is not. The audit generator emits one
   * item per name either way, so certificate and item still map 1:1 when the
   * producer does have it to hand.
   */
  attachment?: SoldDocumentMeta;
}

/**
 * Discounts & Required Documentation, per policy.
 *
 * Split by branch: the property fields are only meaningful for a policy where
 * `isPropertyPolicyType` holds, the auto fields only where `isAutoPolicyType`
 * does. The server **rejects** a cross-branch selection rather than stripping
 * it — a Home policy claiming `studentDiscount` is a client bug, and silently
 * dropping it would let a client conjure audit items for a deal that has no
 * auto line.
 */
export interface SoldPolicyDiscounts {
  // --- Home / Renters / Condominium / Landlord ---
  /**
   * Implies a mortgagee, which drives the `Home/Landlord Mortgagee` audit items.
   *
   * A plain boolean, and it stays one: what the audit reads is the keyed-in
   * loan detail on {@link SoldEscrowDetails}, not a document (PAC-65 removed
   * the escrow upload outright). Converting it to a {@link ProofBackedDiscount}
   * would ripple through `deriveMortgagee`, `findCrossBranchDiscounts`,
   * `InterestedPartiesStep` and every fixture to no end.
   *
   * ⚠ PAC-65 also deleted the sibling `inspection` key. There is no document a
   * producer can attach to a passed home inspection, and the
   * `Home Inspection` / `Landlord Inspection` audit items were never driven by
   * it — they come from the policy type, unconditionally. Do not reintroduce
   * the control believing it generates something.
   */
  escrow: boolean;
  fireSubscription: ProofBackedDiscount;
  /** Legacy calls the resulting audit item `Hail Resistant Roof`. */
  roofReceipt: ProofBackedDiscount;
  acvPersonalProperty: boolean;
  acvDwellingProtection: boolean;

  // --- Auto / Auto - Special / Motorcycle ---
  /**
   * ⚠ **The one option on this card that generates no audit item** (PAC-65).
   *
   * Drivewise is a phone app that monitors driving — there is no document that
   * could prove enrolment, so the upload came out, and David asked for the
   * audit item to go with it: knowing Drivewise is on the policy is enough, and
   * the service department works it from the renewal. Recorded here, and on
   * `Deal.auditTriggers.drivewise`, purely as provenance.
   */
  drivewise: boolean;
  defensiveDriver: {
    selected: boolean;
    /** One audit item is generated per driver, each carrying their name. */
    drivers: DefensiveDriverSelection[];
  };
  /** Legacy calls the resulting audit item `Good Student`. */
  studentDiscount: ProofBackedDiscount;

  // --- Every policy type ---
  /**
   * "The client has prior insurance" (PAC-65).
   *
   * Public records do not always show existing coverage, so producers key it in
   * by hand while quoting — and Allstate then wants the declarations page
   * proving coverage for the period entered.
   *
   * Two consequences, both cross-card: it generates the `Prior Insurance` audit
   * item (which stopped being unconditional to make room for it), and it makes
   * the prior-insurance step mandatory — `priorInsurance.none` becomes
   * unreachable. David on why it is asked *here* rather than left to that step:
   * *"if we're not aware that they need prior insurance and they fail to put it
   * in… we miss something and we're not doing a complete audit."*
   */
  priorInsuranceDiscount: boolean;
}

/**
 * Which branch of {@link SoldPolicyDiscounts} each key belongs to.
 *
 * ⚠ **The one source for the split.** It was previously restated three times —
 * the two halves of the web `DiscountsCard`, and the server's
 * `findCrossBranchDiscounts` — with nothing tying them together, and the web
 * form had no notion of the split at all beyond which controls it rendered.
 * That is what let a discount ticked on an Auto policy survive a switch to
 * Home: invisible in the UI, still failing the schema, and rejected by the
 * server if it ever reached it. Anything that clears, validates or rejects a
 * cross-branch selection reads these.
 */
export const AUTO_DISCOUNT_KEYS = [
  'drivewise',
  'defensiveDriver',
  'studentDiscount',
] as const satisfies readonly (keyof SoldPolicyDiscounts)[];

/** @see AUTO_DISCOUNT_KEYS */
export const PROPERTY_DISCOUNT_KEYS = [
  'escrow',
  'fireSubscription',
  'roofReceipt',
  'acvPersonalProperty',
  'acvDwellingProtection',
] as const satisfies readonly (keyof SoldPolicyDiscounts)[];

/**
 * Keys that apply to **every** policy type, auto and property alike.
 *
 * `findCrossBranchDiscounts` iterates only the two branch lists, so a key here
 * is deliberately never cross-branch-checked — which is exactly right for an
 * option a Life or Umbrella policy can carry.
 *
 * ⚠ But `clearInapplicableDiscounts` is the mirror image: it rebuilds from
 * `emptyDiscounts()` and copies forward only the keys it is given. A key in
 * *none* of the three lists is therefore silently wiped every time the producer
 * changes the policy type — ticked, invisible, gone. That is what
 * {@link UniversalDiscountKey} and the guard below exist to prevent.
 */
export const UNIVERSAL_DISCOUNT_KEYS = [
  'priorInsuranceDiscount',
] as const satisfies readonly (keyof SoldPolicyDiscounts)[];

export type AutoDiscountKey = (typeof AUTO_DISCOUNT_KEYS)[number];
export type PropertyDiscountKey = (typeof PROPERTY_DISCOUNT_KEYS)[number];
export type UniversalDiscountKey = (typeof UNIVERSAL_DISCOUNT_KEYS)[number];

/**
 * Every discount key must be classified into exactly one of the three lists.
 *
 * A compile error here means a key was added to {@link SoldPolicyDiscounts}
 * without saying which policy types it applies to. Left unclassified it would
 * escape the server's cross-branch rejection *and* be wiped by the web form's
 * branch reset — two silent failures, neither of which surfaces as an error the
 * producer or the reviewer would see. The error names the key.
 */
type _EveryDiscountKeyIsClassified = Exclude<
  keyof SoldPolicyDiscounts,
  AutoDiscountKey | PropertyDiscountKey | UniversalDiscountKey
> extends never
  ? true
  : ['Unclassified discount key — add it to one of the three key lists'];
/** Referenced so the guard above is not elided as unused. */
export type DiscountKeysAreClassified = _EveryDiscountKeyIsClassified;

/**
 * Is this discount claimed?
 *
 * Normalises the two shapes a discount takes — `escrow` and the two ACV keys
 * are bare booleans, the rest are `{ selected }` — so callers iterating
 * {@link AUTO_DISCOUNT_KEYS} / {@link PROPERTY_DISCOUNT_KEYS} do not each have
 * to re-derive which is which.
 */
export function isDiscountSelected(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'object' || value === null) return false;
  return (value as { selected?: unknown }).selected === true;
}

/**
 * The escrow sub-card, required when `discounts.escrow` is set.
 *
 * ⚠ PAC-65 removed the statement upload that used to sit here. David: *"the
 * audit is going to be based on the information"* — these three keyed-in fields
 * are what the `Home/Landlord Mortgagee` item asks the service team to verify.
 */
export interface SoldEscrowDetails {
  loanNumber: string;
  companyName: string;
  address: StructuredAddress;
}

/** Prior insurance, per policy. Labels track the policy type. */
export interface SoldPriorInsurance {
  /**
   * The "No prior [Type] insurance" toggle; suppresses the other fields.
   *
   * ⚠ Unreachable when `discounts.priorInsuranceDiscount` is ticked — David:
   * *"if they select prior insurance, that top button should not be a
   * selection."* Rejected server-side as well as disabled in the UI, following
   * the same house rule as `none && cancelled`.
   */
  none: boolean;
  carrier?: string;
  agentName?: string;
  /**
   * "Proof of Insurance" — the declarations page showing the coverage period
   * (PAC-65). Required when `discounts.priorInsuranceDiscount` is ticked, which
   * makes it the one upload on the sold form that is **not** optional: failing
   * to supply it in time gets the policy cancelled or repriced.
   *
   * Lives here rather than in a generic proof slot for the same reason the
   * escrow statement used to live on the escrow details — it evidences the
   * carrier and period keyed in beside it.
   */
  attachment?: SoldDocumentMeta;
}

/**
 * Cancellation of the prior policy.
 *
 * Asked inside the prior-insurance step since PAC-56 #24 — a client with no
 * prior insurance has nothing to cancel, and the API rejects the pair rather
 * than silently dropping it.
 */
export interface SoldCancellation {
  cancelled: boolean;
  /** ISO date (YYYY-MM-DD). Required when `cancelled`. */
  effectiveDate?: string;
  /**
   * Who cancelled the prior policy (PAC-65 #11). Required when `cancelled`.
   *
   * Persisted onto the existing (previously unwritten) `cancellationResponsibility`
   * column on `priorInsurance`, whose legacy vocabulary is `Agent` / `Client`.
   * Those are normalized to these values on read rather than migrated, so a
   * SmartSuite import keeps its own bytes.
   */
  cancelledBy?: CancelledBy;
  /**
   * The staff member responsible, when `cancelledBy` is `SFA staff`.
   *
   * ⚠ Verified against the caller's agency server-side before it is stored.
   * Unchecked, a client-supplied user id is a cross-agency write primitive —
   * the same trap `existingPolicyId` documents.
   */
  cancelledByUserId?: string;
}

/**
 * Who cancelled the prior policy.
 *
 * One list so the zod enum, the API DTO and the `<SelectField>` options cannot
 * drift into three spellings of the same two answers.
 */
export const CANCELLED_BY_OPTIONS = ['Customer', 'SFA staff'] as const;
export type CancelledBy = (typeof CANCELLED_BY_OPTIONS)[number];

/** One agency staff member, for the "Cancelled by" picker (PAC-65 #11). */
export interface SoldStaffOption {
  id: string;
  name: string;
  email?: string;
}

/** One iteration of the wizard's per-policy loop. */
export interface SoldPolicyInput {
  /** A canonical label from `POLICY_TYPES` — raw SmartSuite codes are rejected. */
  policyType: string;
  /** The "start date", ISO (YYYY-MM-DD). Stored as `Policy.effectiveDate`. */
  effectiveDate: string;
  carrier: string;
  policyNumber: string;
  /**
   * Set when `GET /policies/check` matched and the producer confirmed "this is
   * the same policy". The submission updates that row instead of inserting a
   * duplicate. Re-validated server-side against the caller's agency and scope.
   */
  existingPolicyId?: string;
  /**
   * The policy this one replaces. **Set only on the Policy Transfer path** —
   * absent on every sale.
   *
   * Distinct from `existingPolicyId`, which means "the row I am describing
   * already exists, update it in place". This means "a *different* policy is
   * being retired and this new one takes over from it", so both rows survive
   * and are linked in both directions.
   */
  fromPolicyId?: string;
  premium: number;
  itemCount: number;
  /**
   * The signed new business application (PAC-56 #23). **Required, PDF-only** —
   * the one exception to the sold form's PDF-or-image rule.
   */
  newBusinessApplication: SoldDocumentMeta;
  /**
   * Optional on the wire: the server defaults an omitted object to "nothing
   * selected", so a policy that genuinely carries no discounts does not have to
   * spell that out in nine false booleans.
   */
  discounts?: SoldPolicyDiscounts;
  escrow?: SoldEscrowDetails;
  priorInsurance: SoldPriorInsurance;
  cancellation: SoldCancellation;
}

export interface CreateSoldDealInput {
  /**
   * Lead-scoped, not household-scoped — the same decision as the Quote Recap
   * form. The API resolves the household from the lead, so a client cannot
   * claim a household it does not own.
   */
  leadId: string;
  /** One sold date for the whole deal, ISO (YYYY-MM-DD). */
  soldDate: string;
  /** Optional: not every sale has a recorded quote. */
  quoteRecapId?: string;
  /** At least one; the wizard's loop card appends to this array. */
  policies: SoldPolicyInput[];
  /**
   * Client-generated per-wizard-session idempotency key. A double-click or a
   * retried request resolves to the same deal instead of creating a second —
   * and, critically, does not generate a second set of audit items.
   */
  submissionToken?: string;
}

/**
 * `POST /sold-deals`.
 *
 * Totals are **derived server-side** from the policy rows and never trusted
 * from the client; `auditItemCount` is echoed so the wizard's success screen
 * can say how large a hand-off the service team just received.
 */
export interface CreateSoldDealResponse {
  id: string;
  leadId: string;
  premium: number;
  itemCount: number;
  policyCount: number;
  policyTypes: string[];
  dealType: string;
  isBundle: boolean;
  /** ISO-8601. Backs the Sold scorecard; a deal without one is invisible to it. */
  soldDate: string;
  /** The lead's status **after** the forward-only advance. */
  leadStatus: string;
  /** Audit items generated for the service hand-off board. */
  auditItemCount: number;
  /** Whether a CRM was assigned from the producer's rotation. */
  crmAssigned: boolean;
}

/**
 * `GET /sold-deals/context?leadId=` — what the wizard needs on mount: who the
 * sale is for, and which household members can be named as drivers.
 */
export interface SoldDealLeadContext {
  leadId: string;
  primaryContactName: string;
  /** `null` when the lead has no household — submission would be rejected. */
  householdId: string | null;
  householdName: string | null;
  /** Feeds Card 5's Defensive Driver picker. */
  contacts: SoldHouseholdContact[];
  leadStatus: string;
  /**
   * Whether a quote recap exists for this lead (PAC-56 #17).
   *
   * The wizard blocks without one, so a typed `/sold/new?leadId=…` cannot walk
   * around the disabled "Mark as Sold" button. Computed with the same
   * `legacyLeadId` fallback the Lead Detail read uses — the migration links
   * recaps only by legacy id, so a bare `leadId` probe would report `false` for
   * every migrated lead.
   */
  hasQuoteRecap: boolean;
}

export interface SoldHouseholdContact {
  id: string;
  firstName: string;
  lastName: string;
  roleInHousehold?: string;
}

/** `POST /sold-deals/documents/presign`. */
export interface SoldDocumentPresignResponse {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}
