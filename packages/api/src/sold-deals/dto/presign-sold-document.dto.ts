import { z } from 'zod';

/**
 * What the sold form accepts as a discount proof.
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

/**
 * The kinds of document the sold form uploads, and what each accepts.
 *
 * ⚠ The **New Business Application is PDF-only** (PAC-56 #23) — the deliberate
 * exception to #22's PDF-or-image rule. It is a signed application, not a
 * photographed receipt, and the data-accuracy case for requiring it is the
 * reason David asked for it at all.
 */
export const SOLD_UPLOAD_KINDS = {
  discount_proof: ALLOWED_SOLD_DOCUMENT_CONTENT_TYPES,
  new_business_application: ['application/pdf'],
} as const;

export type SoldUploadKind = keyof typeof SOLD_UPLOAD_KINDS;

export const SOLD_UPLOAD_KIND_VALUES = Object.keys(SOLD_UPLOAD_KINDS) as [
  SoldUploadKind,
  ...SoldUploadKind[],
];

/**
 * Everything a presign body carries apart from its anchor.
 *
 * A plain shape rather than a schema, because both anchors build their own
 * object from it: zod refuses `.omit()` on a schema that already carries
 * refinements, so deriving one from the other is not available.
 */
const presignFields = {
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_SOLD_DOCUMENT_CONTENT_TYPES),
  /**
   * What this upload is for (PAC-56 #23). Defaults to `discount_proof`, so
   * every caller that predates the New Business Application keeps working
   * unchanged.
   */
  kind: z.enum(SOLD_UPLOAD_KIND_VALUES).default('discount_proof'),
  /**
   * A claim, not evidence — the presigned PUT signs only the content type, so
   * nothing stops a caller uploading a larger file against a valid URL. Bounded
   * here to fail fast on the obvious case; `create` re-derives the real size
   * from storage and is what actually enforces the limit.
   */
  size: z.coerce.number().int().positive().max(MAX_SOLD_DOCUMENT_BYTES),
};

/** The kind→content-type narrowing, applied by both anchors. */
function refineUploadKind(
  value: { kind: SoldUploadKind; contentType: string },
  ctx: z.RefinementCtx,
): void {
  const allowed: readonly string[] = SOLD_UPLOAD_KINDS[value.kind];
  if (!allowed.includes(value.contentType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        value.kind === 'new_business_application'
          ? 'The new business application must be a PDF.'
          : 'Documents must be a PDF, JPEG or PNG.',
      path: ['contentType'],
    });
  }
}

export const presignSoldDocumentSchema = z
  .object({
    /**
     * Lead-scoped, matching the Quote Recap presign: the document is uploaded
     * while the wizard is still being filled in, so no deal exists yet to scope
     * it to. The key that comes back embeds the agency and lead, which is what
     * `create` later verifies.
     */
    leadId: z.string().trim().length(24),
    ...presignFields,
  })
  .superRefine(refineUploadKind);

export type PresignSoldDocumentDto = z.infer<typeof presignSoldDocumentSchema>;

/**
 * The object-key purpose segment for a lead's sold-form documents.
 *
 * ⚠ The `discount_proof` segment is **byte-identical** to what this returned
 * before PAC-56 #23 added the parameter, and must stay that way: there are
 * in-flight keys in every environment, and an e2e case hard-codes the prefix.
 *
 * Encoding the kind in the key is what makes `assertKeyOwnership` enforce it at
 * verification time for free — a JPEG presigned as a discount proof cannot then
 * be declared as the New Business Application, because its key sits under the
 * wrong prefix. That, plus the `HeadObject` content-type re-check, is the real
 * gate; the presign narrowing above is only a fast-fail.
 */
export function soldDocumentPurpose(
  leadId: string,
  kind: SoldUploadKind = 'discount_proof',
): string {
  const base = `sold-deals/${leadId}`;
  return kind === 'new_business_application' ? `${base}/nba` : base;
}

/**
 * The same, for a **policy transfer** — anchored on the household instead of a
 * lead, because a transfer has no lead.
 *
 * A separate namespace rather than a widened `soldDocumentPurpose`: the two id
 * spaces are different collections, and sharing one prefix would let a key
 * presigned against a household be replayed against a lead of the same id (or
 * vice versa) with `assertKeyOwnership` none the wiser. Keeping them disjoint
 * means the prefix check keeps meaning what it says.
 */
export function transferDocumentPurpose(
  householdId: string,
  kind: SoldUploadKind = 'discount_proof',
): string {
  const base = `policy-transfers/${householdId}`;
  return kind === 'new_business_application' ? `${base}/nba` : base;
}

/**
 * The presign body for a transfer — the same fields with no anchor in the body
 * at all: the ticket is a path parameter, and the household is read off it
 * server-side so a caller cannot name one.
 */
export const presignTransferDocumentSchema = z
  .object(presignFields)
  .superRefine(refineUploadKind);

export type PresignTransferDocumentDto = z.infer<
  typeof presignTransferDocumentSchema
>;
