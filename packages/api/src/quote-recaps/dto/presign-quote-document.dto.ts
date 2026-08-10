import { z } from 'zod';

/**
 * Content types accepted for the carrier quote document.
 *
 * Matches the deal-audit rule rather than the `sfaforms` prototype's PDF-only
 * constraint: producers routinely photograph a quote, and one consistent upload
 * rule across the app is worth more than the prototype's guess.
 *
 * Deliberately its own constant rather than an import from `deal-audits/dto/`:
 * the two features must stay free to diverge on what they accept, and a
 * cross-feature DTO import is coupling the module boundary shouldn't carry.
 */
export const ALLOWED_QUOTE_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

/** Max upload size (10 MB), matching the UI copy. */
export const MAX_QUOTE_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Metadata for an already-uploaded quote document.
 *
 * `contentType` and `size` are validated here as a fast client-side-mirroring
 * rejection, but they are **not** what the record ends up storing — the service
 * re-reads both from `HeadObject`, because a presigned PUT signs only the
 * content type and a declared size proves nothing about the stored object.
 */
export const quoteDocumentSchema = z.object({
  key: z.string().trim().min(1).max(512),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_QUOTE_DOCUMENT_CONTENT_TYPES),
  size: z.coerce.number().int().positive().max(MAX_QUOTE_DOCUMENT_BYTES),
});

export const presignQuoteDocumentSchema = z.object({
  /** The lead the recap will be filed under — scopes the object key. */
  leadId: z.string().trim().length(24),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_QUOTE_DOCUMENT_CONTENT_TYPES),
  size: z.coerce.number().int().positive().max(MAX_QUOTE_DOCUMENT_BYTES),
});

export type PresignQuoteDocumentDto = z.infer<
  typeof presignQuoteDocumentSchema
>;

/** `GET /quote-recaps/context?leadId=` */
export const leadContextSchema = z.object({
  leadId: z.string().trim().length(24),
});

export type LeadContextDto = z.infer<typeof leadContextSchema>;
