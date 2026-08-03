import { z } from 'zod';

/**
 * What Card 5 accepts as proof of a discount.
 *
 * Feature-local rather than imported from deal-audits: the two features must be
 * free to diverge (a carrier proof is not a resolution document), and a
 * cross-feature DTO import couples a boundary that should stay separate. They
 * happen to agree today, and that is fine — producers photograph carrier
 * paperwork, so images matter as much as PDFs.
 */
export const ALLOWED_SOLD_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const MAX_SOLD_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const presignSoldDocumentSchema = z.object({
  /**
   * Lead-scoped, matching the Quote Recap presign: the document is uploaded
   * while the wizard is still being filled in, so no deal exists yet to scope
   * it to. The key that comes back embeds the agency and lead, which is what
   * `create` later verifies.
   */
  leadId: z.string().trim().length(24),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_SOLD_DOCUMENT_CONTENT_TYPES),
  /**
   * A claim, not evidence — the presigned PUT signs only the content type, so
   * nothing stops a caller uploading a larger file against a valid URL. Bounded
   * here to fail fast on the obvious case; `create` re-derives the real size
   * from storage and is what actually enforces the limit.
   */
  size: z.coerce.number().int().positive().max(MAX_SOLD_DOCUMENT_BYTES),
});

export type PresignSoldDocumentDto = z.infer<typeof presignSoldDocumentSchema>;

/** The object-key purpose segment for a lead's sold-form documents. */
export function soldDocumentPurpose(leadId: string): string {
  return `sold-deals/${leadId}`;
}
