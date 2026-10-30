import { CORE_AUDIT_TEMPLATES } from '../seed/audit-templates.seed';
import { auditItemFlagsForName } from './audit-visibility';

/**
 * Who sees an item (PAC-106 §3), for items known only by name — migrated ones.
 * The expectations are David's table, confirmed item by item on 24 Aug.
 */
describe('auditItemFlagsForName', () => {
  it.each([
    'Correct Sold Date',
    'Correct Effective Date',
    'Quote Recap',
    'Lead Manager',
    'Evidence of Insurance',
    'Drivers Verified',
  ])('keeps %s from the producer', (name) => {
    expect(auditItemFlagsForName(name)).toEqual({
      producerVisible: false,
      requiresUpload: false,
    });
  });

  it.each([
    'Good Student',
    'Prior Insurance',
    'Accord Cancellation',
    'Defensive Driver',
    'Home Fire Subscription',
    'Landlord Hail Resistant Roof',
  ])('asks the producer for a document on %s', (name) => {
    expect(auditItemFlagsForName(name)).toEqual({
      producerVisible: true,
      requiresUpload: true,
    });
  });

  it.each(['Home Inspection', 'Landlord Mortgagee', 'Home Actual Cash Value'])(
    'asks the producer a yes/no on %s, with no upload',
    (name) => {
      expect(auditItemFlagsForName(name)).toEqual({
        producerVisible: true,
        requiresUpload: false,
      });
    },
  );

  it('strips the subject suffix a fanned-out item carries', () => {
    expect(auditItemFlagsForName('Defensive Driver — Sam Lopez')).toEqual({
      producerVisible: true,
      requiresUpload: true,
    });
  });

  it('maps the legacy names the SmartSuite import writes', () => {
    expect(auditItemFlagsForName('Fire Subscription').requiresUpload).toBe(
      true,
    );
    expect(auditItemFlagsForName('Hail Resistant Roof').requiresUpload).toBe(
      true,
    );
    expect(auditItemFlagsForName('Actual Cash Value')).toEqual({
      producerVisible: true,
      requiresUpload: false,
    });
    expect(auditItemFlagsForName('(Mortgagee) Escrow Payment')).toEqual({
      producerVisible: true,
      requiresUpload: false,
    });
  });

  it('leaves retired Drivewise to the manager', () => {
    expect(auditItemFlagsForName('Drivewise').producerVisible).toBe(false);
  });

  it('defaults an unknown name to visible with no file', () => {
    expect(auditItemFlagsForName('Something an agency added')).toEqual({
      producerVisible: true,
      requiresUpload: false,
    });
    expect(auditItemFlagsForName(undefined).producerVisible).toBe(true);
  });

  it('covers every core template', () => {
    for (const template of CORE_AUDIT_TEMPLATES) {
      expect(auditItemFlagsForName(template.name)).toEqual({
        producerVisible: template.producerVisible,
        requiresUpload: template.requiresUpload,
      });
    }
  });
});
