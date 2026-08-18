import type { SoldDocumentMeta, SoldPolicyInput } from '@sfa/shared';
import { attachmentKey } from '../../audit-generation/audit-titles';
import { auditAttachmentsByItem } from './sold-audit-attachments';

const EMPTY_DISCOUNTS: SoldPolicyInput['discounts'] = {
  escrow: false,
  fireSubscription: { selected: false },
  roofReceipt: { selected: false },
  acvPersonalProperty: false,
  acvDwellingProtection: false,
  drivewise: false,
  defensiveDriver: { selected: false, drivers: [] },
  studentDiscount: { selected: false },
  priorInsuranceDiscount: false,
};

const proof = (name: string): SoldDocumentMeta => ({
  key: `agencies/a/sold-deals/l/2026/${name}.pdf`,
  filename: `${name}.pdf`,
  contentType: 'application/pdf',
  size: 1024,
});

function policy(overrides: Partial<SoldPolicyInput> = {}): SoldPolicyInput {
  return {
    policyType: 'Auto',
    effectiveDate: '2026-01-15',
    carrier: 'Allstate',
    policyNumber: '123456789',
    premium: 100,
    itemCount: 1,
    discounts: structuredClone(EMPTY_DISCOUNTS),
    priorInsurance: { none: true },
    cancellation: { cancelled: false },
    ...overrides,
  };
}

/** What the generator would look the attachment up by. */
const keyFor = (title: string, subjectName?: string) =>
  attachmentKey({ title, subjectName });

describe('auditAttachmentsByItem (PAC-56 #21b)', () => {
  it('maps a flat auto discount onto its item', () => {
    const file = proof('transcript');
    const map = auditAttachmentsByItem([
      policy({
        discounts: {
          ...structuredClone(EMPTY_DISCOUNTS),
          studentDiscount: { selected: true, attachment: file },
        },
      }),
    ]);

    expect(map.get(keyFor('Good Student'))?.[0].key).toBe(file.key);
  });

  it('maps nothing for Drivewise, which generates no item (PAC-65)', () => {
    // A bare boolean since PAC-65, with no attachment slot and no audit item to
    // attach one to. Asserted rather than assumed: the old mapping existed, and
    // reviving it would key a file to an item generation never creates.
    const map = auditAttachmentsByItem([
      policy({
        discounts: { ...structuredClone(EMPTY_DISCOUNTS), drivewise: true },
      }),
    ]);

    expect(map.size).toBe(0);
  });

  it('uses the audit vocabulary, not the form control name', () => {
    // The form says "student discount" and "roof receipt"; the checklist says
    // "Good Student" and "Hail Resistant Roof". Getting this wrong attaches a
    // file to an item that was never generated.
    const student = proof('transcript');
    const roof = proof('roof');
    const map = auditAttachmentsByItem([
      policy({
        discounts: {
          ...structuredClone(EMPTY_DISCOUNTS),
          studentDiscount: { selected: true, attachment: student },
        },
      }),
      policy({
        policyType: 'Home',
        discounts: {
          ...structuredClone(EMPTY_DISCOUNTS),
          roofReceipt: { selected: true, attachment: roof },
        },
      }),
    ]);

    expect(map.get(keyFor('Good Student'))?.[0].key).toBe(student.key);
    expect(map.get(keyFor('Home Hail Resistant Roof'))?.[0].key).toBe(roof.key);
  });

  it('expands both Home and Landlord variants when the deal has both', () => {
    // Each property needs its own proof, and `computeRequiredTitles` generates
    // both items — so both have to be reachable.
    const fire = proof('fire');
    const map = auditAttachmentsByItem([
      policy({
        policyType: 'Home',
        discounts: {
          ...structuredClone(EMPTY_DISCOUNTS),
          fireSubscription: { selected: true, attachment: fire },
        },
      }),
      policy({ policyType: 'Landlord' }),
    ]);

    expect(map.has(keyFor('Home Fire Subscription'))).toBe(true);
    expect(map.has(keyFor('Landlord Fire Subscription'))).toBe(true);
  });

  it('keys a defensive-driver certificate by the driver name', () => {
    const dana = proof('dana');
    const sam = proof('sam');
    const map = auditAttachmentsByItem([
      policy({
        discounts: {
          ...structuredClone(EMPTY_DISCOUNTS),
          defensiveDriver: {
            selected: true,
            drivers: [
              { name: 'Dana Driver', attachment: dana },
              { name: 'Sam Second', attachment: sam },
            ],
          },
        },
      }),
    ]);

    expect(map.get(keyFor('Defensive Driver', 'Dana Driver'))?.[0].key).toBe(
      dana.key,
    );
    expect(map.get(keyFor('Defensive Driver', 'Sam Second'))?.[0].key).toBe(
      sam.key,
    );
  });

  it('keeps the first certificate when one driver appears on two policies', () => {
    // `deriveAuditTriggers` dedupes driver names, so the two policies collapse
    // to one audit item and one of the two certificates has to win.
    const first = proof('first');
    const second = proof('second');
    const withDriver = (attachment: SoldDocumentMeta) =>
      policy({
        discounts: {
          ...structuredClone(EMPTY_DISCOUNTS),
          defensiveDriver: {
            selected: true,
            drivers: [{ name: 'Dana Driver', attachment }],
          },
        },
      });

    const map = auditAttachmentsByItem([withDriver(first), withDriver(second)]);

    expect(map.get(keyFor('Defensive Driver', 'Dana Driver'))).toHaveLength(1);
    expect(map.get(keyFor('Defensive Driver', 'Dana Driver'))?.[0].key).toBe(
      first.key,
    );
  });

  it('maps nothing onto the Mortgagee item — escrow has no upload (PAC-65)', () => {
    // The statement dropzone was removed outright. David: *"the audit is going
    // to be based on the information"* — the `Home Mortgagee` item asks the
    // service team to verify the loan detail keyed in below, not a file.
    const map = auditAttachmentsByItem([
      policy({
        policyType: 'Home',
        discounts: { ...structuredClone(EMPTY_DISCOUNTS), escrow: true },
        escrow: {
          loanNumber: 'LN-1',
          companyName: 'Escrow Co',
          address: {
            street: '1 Way',
            city: 'Tulsa',
            state: 'OK',
            zip: '74101',
          },
        },
      }),
    ]);

    expect(map.has(keyFor('Home Mortgagee'))).toBe(false);
  });

  it('is empty when nothing was uploaded', () => {
    expect(auditAttachmentsByItem([policy()]).size).toBe(0);
  });

  it('ignores a selected discount with no attachment', () => {
    // The normal case since PAC-65: the discount is claimed, no document came
    // with it, and the audit item is generated regardless — it just carries no
    // attachment, so the auditor is told to call the client for it.
    const map = auditAttachmentsByItem([
      policy({
        discounts: {
          ...structuredClone(EMPTY_DISCOUNTS),
          studentDiscount: { selected: true },
        },
      }),
    ]);
    expect(map.size).toBe(0);
  });
});
