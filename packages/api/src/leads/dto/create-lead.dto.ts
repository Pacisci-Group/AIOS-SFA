import {
  HOUSEHOLD_MEMBER_ROLES,
  SELECTABLE_LEAD_SOURCE_OPTIONS,
} from '@sfa/shared';
import { z } from 'zod';

/** `Test` (ENEJP) is excluded — it must never be selectable at intake. */
const SELECTABLE_LEAD_SOURCE_CODES = SELECTABLE_LEAD_SOURCE_OPTIONS.map(
  (option) => option.code,
) as [string, ...string[]];

const name = z.string().trim().min(1).max(60);
const dateOfBirth = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD');

const person = z.object({
  firstName: name,
  lastName: name,
  dateOfBirth,
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().max(160),
});

const member = z.object({
  firstName: name,
  lastName: name,
  /** Optional for members — only the primary contact must supply a DOB. */
  dateOfBirth: dateOfBirth.optional(),
  role: z.enum(HOUSEHOLD_MEMBER_ROLES),
});

/**
 * The household's **living** address.
 *
 * Optional in the API even though the web form requires it. A partial
 * submission that still identifies a person is worth strictly more than a 400:
 * rejecting it loses the lead entirely, and the address only powers a dedupe
 * signal that degrades gracefully when absent.
 */
const address = z.object({
  street: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  zip: z.string().trim().max(20).optional(),
});

/** Fields shared by the authenticated and public intake forms. */
export const leadIntakeBaseSchema = z.object({
  primaryContact: person,
  address: address.optional(),
  members: z.array(member).max(10).default([]),
  quoteControlNumber: z.string().trim().max(60).optional(),
  /**
   * Client-generated, stable for the lifetime of one form session — that is
   * what makes a retry after a failed submit idempotent rather than duplicating.
   */
  submissionToken: z.string().trim().min(8).max(200).optional(),
});

/** `POST /leads` — the authenticated form, where lead source is required. */
export const createLeadSchema = leadIntakeBaseSchema.extend({
  leadSourceCode: z.enum(SELECTABLE_LEAD_SOURCE_CODES),
});

export type CreateLeadDto = z.infer<typeof createLeadSchema>;

/**
 * `POST /public/leads/:token` — the same fields **minus** `leadSourceCode`.
 *
 * Lead source is internal vocabulary (Quotewizard, Soleo, Data Lot, JYA) and is
 * never shown to an outside submitter; a producer sets it afterwards. Because
 * zod strips unknown keys, an injected `leadSourceCode` — or `agencyId`,
 * `producerId`, `branchId` — is silently discarded here, and `LeadIntakeService`
 * reads none of them anyway. Two independent layers.
 */
export const publicCreateLeadSchema = leadIntakeBaseSchema;

export type PublicCreateLeadDto = z.infer<typeof publicCreateLeadSchema>;
