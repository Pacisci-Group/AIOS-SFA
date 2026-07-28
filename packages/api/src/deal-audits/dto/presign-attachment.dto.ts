import { z } from 'zod';

/** Content types accepted for audit-resolution document uploads. */
export const ALLOWED_ATTACHMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

/** Max upload size (10 MB), matching the UI copy. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const presignAttachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_ATTACHMENT_CONTENT_TYPES),
  size: z.coerce.number().int().positive().max(MAX_ATTACHMENT_BYTES),
});

export type PresignAttachmentDto = z.infer<typeof presignAttachmentSchema>;
