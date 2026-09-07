import { z } from 'zod';

/**
 * The ZIP → market table's request shapes (PAC-71).
 *
 * `zip5` is validated here **and** on the schema. Not redundancy: the seed and
 * the campaign preview also write rows, and only the schema sees those, while
 * only the DTO can turn a bad value into a `400` instead of a `ValidationError`
 * surfacing as a 500.
 */

const zip5 = z
  .string()
  .trim()
  // ⚠ Exactly five digits, never zero-padded to fit. The seed source carries a
  // four-digit typo (`4031`, which should be `74031`) and padding it would map
  // `04031` — Freeport, Maine — to Tulsa.
  .regex(/^\d{5}$/, 'zip5 must be exactly 5 digits');

const market = z.string().trim().min(1).max(60);

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{24}$/, 'expected a 24-hex ObjectId');

export const listZipMarketsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  /** Prefix on the ZIP, or a substring of the market name. */
  q: z.string().trim().max(60).optional(),
  /**
   * Which scope to list. Absent = the global table, which is the only one
   * anything writes in this ticket.
   */
  agencyId: objectId.optional(),
});
export type ListZipMarketsDto = z.infer<typeof listZipMarketsSchema>;

/**
 * Bulk upsert — one row, a hand-typed correction, or a pasted block.
 *
 * Capped at 1,000 entries: the seeded table is 564 rows, so a legitimate paste
 * of the whole thing fits, while a runaway client cannot turn one request into
 * an unbounded `bulkWrite`.
 */
export const upsertZipMarketsSchema = z.object({
  entries: z
    .array(
      z.object({
        zip5,
        market,
        /** Omitted = the global row. Nothing sends this yet; see the schema. */
        agencyId: objectId.nullish(),
      }),
    )
    .min(1)
    .max(1000),
});
export type UpsertZipMarketsDto = z.infer<typeof upsertZipMarketsSchema>;
