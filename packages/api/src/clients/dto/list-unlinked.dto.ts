import { UNLINKED_RECORD_KINDS } from '@sfa/shared';
import { z } from 'zod';

/**
 * Query params for `GET /clients/unlinked` — the Unlinked records work list
 * (PAC-91 §10).
 *
 * Shaped like `list-households.dto.ts`: values arrive as strings, so everything
 * is coerced, bounded and defaulted here rather than in the service.
 *
 * `kind` is **required and has no default**, unlike every other filter in this
 * folder. The three lists answer three different questions and hold three
 * different row shapes, so a request that forgot to say which one it wants is a
 * 400 rather than a guess — the counts endpoint is what a caller wanting "all
 * of it at once" is asking for.
 */
export const listUnlinkedSchema = z.object({
  kind: z.enum(UNLINKED_RECORD_KINDS),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/** Inferred type — single source of truth for the parsed query. */
export type ListUnlinkedDto = z.infer<typeof listUnlinkedSchema>;
