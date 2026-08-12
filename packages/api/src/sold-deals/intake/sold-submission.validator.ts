import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { carrierPolicyNumberMatches, carrierSlug } from '@sfa/shared';
import type { SoldDocumentMeta } from '@sfa/shared';
import { CarriersService } from '../../carriers/carriers.service';
import { policyNumberKey } from '../../policies/policy-number';
import { StorageService } from '../../storage/storage.service';
import {
  MAX_SOLD_DOCUMENT_BYTES,
  SOLD_UPLOAD_KINDS,
  type SoldUploadKind,
} from '../dto/presign-sold-document.dto';
import type { SoldIntakeDto } from '../dto/create-sold-deal.dto';
import { collectAttachments } from './sold.normalize';

/**
 * The allow-list per upload kind, as `HeadObject` enforces it.
 *
 * Derived from `SOLD_UPLOAD_KINDS` rather than re-listed, so the presign
 * narrowing and this verification can never disagree — the presign is a
 * fast-fail, this is the gate.
 */
const ALLOWED_CONTENT_TYPES = Object.fromEntries(
  Object.entries(SOLD_UPLOAD_KINDS).map(([kind, types]) => [
    kind,
    new Set<string>(types),
  ]),
) as Record<SoldUploadKind, Set<string>>;

/**
 * The two checks a policy submission must pass before the transaction opens,
 * shared by the Sold form and the Policy Transfer.
 *
 * Lifted out of `SoldDealsService` when the transfer needed them: both rules are
 * about the *policy rows*, not about how the submission arrived, and a second
 * copy of the attachment verification in particular would be a security bug
 * waiting to happen — it is the only thing standing between a caller and any
 * object key they can guess.
 */
@Injectable()
export class SoldSubmissionValidator {
  constructor(
    private readonly carriers: CarriersService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Enforce each carrier's policy-number format, where the catalog defines one.
   *
   * This — not the client-side schema — is the real gate: the wizard's zod
   * factory is built from the same catalog, but nothing stops a direct POST.
   */
  async assertPolicyNumberFormats(
    dto: SoldIntakeDto,
    agencyId: string,
  ): Promise<void> {
    // Only reach for the catalog if some row could actually be constrained.
    if (dto.policies.length === 0) return;

    const bySlug = await this.carriers.optionsBySlug(agencyId);
    if (bySlug.size === 0) return;

    dto.policies.forEach((policy, index) => {
      const carrier = bySlug.get(carrierSlug(policy.carrier));
      if (!carrier?.policyNumberPattern) return;

      const key = policyNumberKey(policy.policyNumber);
      if (carrierPolicyNumberMatches(carrier.policyNumberPattern, key)) return;

      throw new BadRequestException(
        `Policy ${index + 1}: ${
          carrier.policyNumberHint ??
          `"${policy.policyNumber}" is not a valid ${carrier.name} policy number.`
        }`,
      );
    });
  }

  /**
   * Verify every uploaded document actually landed, and replace the client's
   * claimed `contentType` / `size` with what storage reports.
   *
   * The presigned PUT signs only the content type, so the declared size in the
   * body is a claim rather than evidence — a caller holding a valid URL can
   * upload a 5 GB file. `HeadObject` is the only server-side proof of what was
   * really stored, which is what makes the limits enforced rather than
   * advisory.
   *
   * **Mutates the DTO in place**, so everything downstream persists the verified
   * metadata rather than the claim.
   *
   * `purposeFor` is injected rather than derived here because the two write
   * paths anchor their keys differently — the Sold form on its lead, a transfer
   * on its household. That prefix *is* the ownership check, so it has to come
   * from the caller that knows which anchor applies.
   */
  async verifyAttachments(
    dto: SoldIntakeDto,
    agencyId: string,
    purposeFor: (kind: SoldUploadKind) => string,
  ): Promise<void> {
    for (const { attachment, kind } of collectAttachments(dto.policies)) {
      /*
       * Reject a key this agency and anchor did not produce, before touching
       * storage — otherwise a caller could attach any object they knew of,
       * including another agency's.
       *
       * The purpose carries the **kind** (PAC-56 #23), so this also rejects a
       * JPEG presigned as a discount proof and then declared as the New
       * Business Application: its key sits under the wrong prefix. The
       * content-type check below is the second, independent gate.
       */
      this.storage.assertKeyOwnership(attachment.key, {
        agencyId,
        purpose: purposeFor(kind),
      });

      const stored = await this.storage.statObject(attachment.key);
      if (!stored) {
        throw new NotFoundException(
          'An uploaded document was not found in storage.',
        );
      }
      if (stored.size > MAX_SOLD_DOCUMENT_BYTES) {
        throw new BadRequestException('A document is larger than 10MB.');
      }
      const allowed = ALLOWED_CONTENT_TYPES[kind];
      if (!stored.contentType || !allowed.has(stored.contentType)) {
        throw new BadRequestException(
          kind === 'new_business_application'
            ? 'The new business application must be a PDF.'
            : 'Documents must be a PDF, JPEG or PNG.',
        );
      }

      attachment.contentType = stored.contentType ?? attachment.contentType;
      attachment.size = stored.size;
    }
  }
}

export type { SoldDocumentMeta };
