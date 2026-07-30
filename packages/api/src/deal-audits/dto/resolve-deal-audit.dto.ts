import { z } from 'zod';
import {
  ALLOWED_ATTACHMENT_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
} from './presign-attachment.dto';

/** Metadata for a document that was uploaded to a presigned URL. */
const attachmentSchema = z.object({
  key: z.string().trim().min(1).max(512),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_ATTACHMENT_CONTENT_TYPES),
  size: z.coerce.number().int().positive().max(MAX_ATTACHMENT_BYTES),
});

export const resolveDealAuditSchema = z.object({
  /** Optional resolution note. */
  note: z.string().trim().max(2000).optional(),
  /** Optional supporting document (already uploaded via presign). */
  attachment: attachmentSchema.optional(),
});

export type ResolveDealAuditDto = z.infer<typeof resolveDealAuditSchema>;
