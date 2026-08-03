/**
 * Sold Deal wire contracts (PAC-40) — shared by the NestJS write path and the
 * `/sold/new` 8-card wizard.
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

/** A discount whose proof is either attached now or chased through the audit. */
export interface ProofBackedDiscount {
  selected: boolean;
  /** When false the discount still applies — the proof becomes an audit item. */
  hasProof: boolean;
  /** Required when `selected && hasProof`. */
  attachment?: SoldDocumentMeta;
}

/** A driver named on the Defensive Driver discount. */
export interface DefensiveDriverSelection {
  /** Display name, used as the audit item's subject so N items stay distinct. */
  name: string;
  /** Set when the driver was picked from the household rather than typed. */
  contactId?: string;
}

/**
 * Card 5 — Discounts & Required Documentation, per policy.
 *
 * Split by branch: the property fields are only meaningful for a policy where
 * `isPropertyPolicyType` holds, the auto fields only where `isAutoPolicyType`
 * does. The server **rejects** a cross-branch selection rather than stripping
 * it — a Home policy claiming `drivewise` is a client bug, and silently
 * dropping it would let a client conjure audit items for a deal that has no
 * auto line.
 */
export interface SoldPolicyDiscounts {
  // --- Home / Renters / Condominium / Landlord ---
  /** Implies a mortgagee, which drives the `Home/Landlord Mortgagee` audit items. */
  escrow: boolean;
  fireSubscription: ProofBackedDiscount;
  /** Legacy calls the resulting audit item `Hail Resistant Roof`. */
  roofReceipt: ProofBackedDiscount;
  acvPersonalProperty: boolean;
  acvDwellingProtection: boolean;

  // --- Auto / Auto - Special / Motorcycle ---
  /** Always generates an audit item: service must mention registration. */
  drivewise: boolean;
  defensiveDriver: {
    selected: boolean;
    /** One audit item is generated per driver, each carrying their name. */
    drivers: DefensiveDriverSelection[];
  };
  /** Legacy calls the resulting audit item `Good Student`. */
  studentDiscount: ProofBackedDiscount;
}

/** The escrow sub-card, required when `discounts.escrow` is set. */
export interface SoldEscrowDetails {
  loanNumber: string;
  companyName: string;
  address: StructuredAddress;
}

/** Card 6 — Prior Insurance, per policy. Labels track the policy type. */
export interface SoldPriorInsurance {
  /** The "No prior [Type] insurance" toggle; suppresses the other fields. */
  none: boolean;
  carrier?: string;
  agentName?: string;
}

/** Card 7 — Cancellation of the prior policy. */
export interface SoldCancellation {
  cancelled: boolean;
  /** ISO date (YYYY-MM-DD). Required when `cancelled`. */
  effectiveDate?: string;
}

/** One iteration of the wizard's Card 2 → Card 7 loop. */
export interface SoldPolicyInput {
  /** A canonical label from `POLICY_TYPES` — raw SmartSuite codes are rejected. */
  policyType: string;
  /** Card 3 "start date", ISO (YYYY-MM-DD). Stored as `Policy.effectiveDate`. */
  effectiveDate: string;
  carrier: string;
  policyNumber: string;
  /**
   * Set when `GET /policies/check` matched and the producer confirmed "this is
   * the same policy". The submission updates that row instead of inserting a
   * duplicate. Re-validated server-side against the caller's agency and scope.
   */
  existingPolicyId?: string;
  premium: number;
  itemCount: number;
  discounts: SoldPolicyDiscounts;
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
  /** Card 1 — one sold date for the whole deal, ISO (YYYY-MM-DD). */
  soldDate: string;
  /** Optional: not every sale has a recorded quote. */
  quoteRecapId?: string;
  /** At least one; the wizard's Card 8 loop appends to this array. */
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
