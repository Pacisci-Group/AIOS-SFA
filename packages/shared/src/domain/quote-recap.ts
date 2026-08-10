/**
 * Quote Recap wire contracts (PAC-39) — shared by the NestJS write path and the
 * `/quote-recaps/new` form.
 *
 * Deliberately plain TypeScript, for the reason given in `lead-intake.ts`: zod
 * is not a dependency of this package. The API validates with its own zod DTO
 * (`dto/create-quote-recap.dto.ts`) and the web app with its own
 * (`features/quote-recap/components/quote-recap-schema.ts`); these interfaces
 * are what both agree the shape is.
 */

import type { StructuredAddress } from './address';

export interface QuoteRecapPolicyInput {
  /** A canonical label from `POLICY_TYPES` — raw SmartSuite codes are rejected. */
  policyType: string;
  premium: number;
  itemCount: number;
}

/**
 * The **insured property** address — explicitly distinct from
 * `LeadIntakeAddress`, which is the household's *living* address. A producer
 * can quote a rental at one address while the client lives at another.
 *
 * An alias rather than its own interface: the shape is the shared
 * {@link StructuredAddress}, and the name records what it means here.
 */
export type QuoteRecapPropertyAddress = StructuredAddress;

/**
 * A quote document that has already been uploaded to storage via presigned PUT.
 * The client sends the `key` it was issued; the server re-derives `contentType`
 * and `size` from the stored object and ignores the declared values.
 */
export interface QuoteDocumentMeta {
  key: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface CreateQuoteRecapInput {
  /**
   * Lead-scoped, not household-scoped: legacy requires a lead and rejects the
   * submission without one. The API resolves the household from the lead.
   */
  leadId: string;
  policies: QuoteRecapPolicyInput[];
  /**
   * When true the server copies the household's own address and **discards**
   * `propertyAddress`, so a client cannot claim "same as household" while
   * submitting something else.
   */
  sameAsHousehold: boolean;
  propertyAddress?: QuoteRecapPropertyAddress;
  notes?: string;
  /** Required — a recap without its carrier quote is not accepted. */
  quoteDocument: QuoteDocumentMeta;
  /**
   * Client-generated per-form-session idempotency key. A double-click or a
   * retried request resolves to the same recap instead of creating a second.
   */
  submissionToken?: string;
}

/**
 * `POST /quote-recaps`.
 *
 * The totals are echoed back because they are **derived server-side** from the
 * policy rows and never trusted from the client — returning them makes that
 * observable without a database query.
 */
export interface CreateQuoteRecapResponse {
  id: string;
  leadId: string;
  premium: number;
  itemCount: number;
  productsQuoted: string[];
  /** ISO-8601. Backs the Quoted scorecard; a recap without one is invisible to it. */
  quoteDate: string;
  /** The lead's status **after** the forward-only advance. */
  leadStatus: string;
}

/**
 * `GET /quote-recaps/context?leadId=` — the read-only header the form shows on
 * mount, so a producer can confirm they are recapping the right household.
 */
export interface QuoteRecapLeadContext {
  leadId: string;
  primaryContactName: string;
  /** `null` when the lead has no household — submission would be rejected. */
  householdId: string | null;
  householdName: string | null;
  /** `null` when nothing usable is on file — the form hides the "same as" toggle. */
  householdAddress: QuoteRecapPropertyAddress | null;
  leadStatus: string;
}

/** `POST /quote-recaps/quote-document/presign`. */
export interface QuoteDocumentPresignResponse {
  key: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresIn: number;
}
