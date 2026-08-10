import { normalizePolicyType } from '@sfa/shared';
import type { SoldDocumentMeta, SoldPolicyInput } from '@sfa/shared';
import {
  attachmentKey,
  homeLandlordVariants,
} from '../../audit-generation/audit-titles';
import type { DealAuditAttachment } from '../../deal-audit-items/schemas/deal-audit-item.schema';

/**
 * Map each discount proof onto the audit item it evidences (PAC-56 #21b).
 *
 * ## Why this exists
 *
 * PAC-56 #21 made proofs **mandatory** — select a discount and you must attach
 * its document. Without this mapping those documents would land in object
 * storage and stop there: `buildItem` wrote `attachments: []`, so the service
 * team working the hand-off board would see an outstanding item and no file.
 * That is strictly worse for them than the old "no — send it to audit" answer,
 * which at least did not make the producer do extra work for nothing.
 *
 * ## The join
 *
 * Keyed by `` `<title>|<subject>` `` via {@link attachmentKey}, the deal-less
 * half of the generator's own dedupe key. Both sides normalize identically, so
 * a title that changes on one side stops matching rather than mis-matching.
 *
 * Variant titles (`Home Fire Subscription` / `Landlord Fire Subscription`) come
 * from {@link homeLandlordVariants}, the same helper `computeRequiredTitles`
 * uses — two copies of that rule would attach a roof receipt to an item that
 * was never generated.
 *
 * ## What maps to what
 *
 * | discount | audit title(s) |
 * |---|---|
 * | `escrow.attachment` | `Home` / `Landlord Mortgagee` |
 * | `inspection` | `Home` / `Landlord Inspection` |
 * | `fireSubscription` | `Home` / `Landlord Fire Subscription` |
 * | `roofReceipt` | `Home` / `Landlord Hail Resistant Roof` |
 * | `drivewise` | `Drivewise` |
 * | `studentDiscount` | `Good Student` |
 * | `defensiveDriver.drivers[]` | `Defensive Driver` — one per driver name |
 *
 * `acvPersonalProperty` / `acvDwellingProtection` carry no document, and the
 * inspection item is generated from the policy type rather than from the
 * control — the control exists only to carry this proof.
 */
export function auditAttachmentsByItem(
  policies: SoldPolicyInput[],
): Map<string, DealAuditAttachment[]> {
  const byItem = new Map<string, DealAuditAttachment[]>();
  const policyTypes = policies.map((p) => normalizePolicyType(p.policyType));

  const add = (
    title: string,
    subjectName: string | undefined,
    attachment: SoldDocumentMeta | undefined,
  ) => {
    if (!attachment) return;
    const key = attachmentKey({ title, subjectName });
    const existing = byItem.get(key);
    // First non-empty wins. Two policies naming the same driver collapse to one
    // audit item upstream (`deriveAuditTriggers` dedupes by trimmed name), so
    // one of the two certificates has to be the one on file.
    if (existing) return;
    byItem.set(key, [
      {
        key: attachment.key,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        uploadedAt: new Date(),
      },
    ]);
  };

  const addVariants = (
    suffix: string,
    attachment: SoldDocumentMeta | undefined,
  ) => {
    for (const title of homeLandlordVariants(policyTypes, suffix)) {
      add(title, undefined, attachment);
    }
  };

  for (const policy of policies) {
    const d = policy.discounts;
    if (!d) continue;

    if (d.escrow) addVariants('Mortgagee', policy.escrow?.attachment);
    if (d.inspection?.selected) {
      addVariants('Inspection', d.inspection.attachment);
    }
    if (d.fireSubscription?.selected) {
      addVariants('Fire Subscription', d.fireSubscription.attachment);
    }
    if (d.roofReceipt?.selected) {
      addVariants('Hail Resistant Roof', d.roofReceipt.attachment);
    }
    if (d.drivewise?.selected) {
      add('Drivewise', undefined, d.drivewise.attachment);
    }
    if (d.studentDiscount?.selected) {
      add('Good Student', undefined, d.studentDiscount.attachment);
    }
    if (d.defensiveDriver?.selected) {
      for (const driver of d.defensiveDriver.drivers ?? []) {
        const name = driver.name?.trim();
        if (name) add('Defensive Driver', name, driver.attachment);
      }
    }
  }

  return byItem;
}
