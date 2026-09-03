import {
  HOUSEHOLD_STATUSES,
  HOUSEHOLD_STATUS_CODE_ALIASES,
  isActiveHouseholdStatus,
  normalizeHouseholdStatus,
} from './household-status';
import {
  POLICY_STATUSES,
  POLICY_STATUS_CODE_ALIASES,
  isActivePolicyStatus,
  normalizePolicyStatus,
} from './policy-status';
import {
  LEGACY_TICKET_CATEGORY_CODE_ALIASES,
  LEGACY_TICKET_PRIORITIES,
  LEGACY_TICKET_STATUSES,
  LEGACY_TICKET_STATUS_CODE_ALIASES,
  LEGACY_TICKET_STATUS_SLUGS,
  normalizeLegacyTicketCategory,
  normalizeLegacyTicketStatus,
  toServiceTicketCategory,
  toServiceTicketPriority,
  toServiceTicketStatus,
} from './legacy-service-ticket';
import {
  TIME_OFF_DECISION_CODE_ALIASES,
  TIME_OFF_REQUEST_TYPE_CODE_ALIASES,
  TIME_OFF_STATUSES,
  TIME_OFF_STATUS_CODE_ALIASES,
  TIME_OFF_TYPE_CODE_ALIASES,
  normalizeTimeOffDecision,
  normalizeTimeOffRequestType,
  normalizeTimeOffStatus,
  normalizeTimeOffType,
} from './time-off';
import {
  CONTACT_ROLES,
  HOUSEHOLD_MEMBER_ROLES,
  HOUSEHOLD_ROLE_CODE_ALIASES,
  PRIMARY_HOUSEHOLD_ROLE,
  normalizeContactRole,
  normalizeHouseholdRole,
} from './household-role';
import {
  SERVICE_TICKET_CATEGORIES,
  SERVICE_TICKET_PRIORITIES,
  SERVICE_TICKET_STATUSES,
} from '../service/service-ticket';

/**
 * The sweep every vocabulary gets: each catalogued code resolves into the
 * canonical set, and each canonical label survives a round trip.
 */
const sweep = (
  name: string,
  aliases: Readonly<Record<string, string>>,
  labels: readonly string[],
  normalize: (raw?: string | null) => string,
) => {
  describe(name, () => {
    it('resolves every catalogued code to a canonical label', () => {
      for (const [code, expected] of Object.entries(aliases)) {
        expect(normalize(code)).toBe(expected);
        expect(labels).toContain(expected);
      }
    });

    it('passes an already-canonical label through unchanged', () => {
      for (const label of labels) {
        expect(normalize(label)).toBe(label);
      }
    });

    it('is case-insensitive on labels but not on codes', () => {
      // Labels are prose and get typed inconsistently; codes are opaque ids
      // where case is significant (`a2E7K`).
      const [first] = labels;
      expect(normalize(first.toUpperCase())).toBe(first);
      expect(normalize(first.toLowerCase())).toBe(first);
    });

    it('returns empty for nothing, and passes the unknown through', () => {
      expect(normalize(null)).toBe('');
      expect(normalize(undefined)).toBe('');
      expect(normalize('   ')).toBe('');
      // Never dropped: an uncatalogued code must still render as itself, and —
      // because Mongoose strips `undefined` from a `$set` — must never come back
      // empty, or a re-import would silently leave the old value in place.
      expect(normalize('zzUnknown')).toBe('zzUnknown');
    });
  });
};

sweep(
  'household status',
  HOUSEHOLD_STATUS_CODE_ALIASES,
  HOUSEHOLD_STATUSES,
  normalizeHouseholdStatus,
);
sweep(
  'policy status',
  POLICY_STATUS_CODE_ALIASES,
  POLICY_STATUSES,
  normalizePolicyStatus,
);
sweep(
  'legacy ticket category',
  LEGACY_TICKET_CATEGORY_CODE_ALIASES,
  SERVICE_TICKET_CATEGORIES,
  normalizeLegacyTicketCategory,
);
sweep(
  'legacy ticket status',
  LEGACY_TICKET_STATUS_CODE_ALIASES,
  LEGACY_TICKET_STATUSES,
  normalizeLegacyTicketStatus,
);
sweep(
  'time-off status',
  TIME_OFF_STATUS_CODE_ALIASES,
  TIME_OFF_STATUSES,
  normalizeTimeOffStatus,
);

describe('the workflow slugs mean different things per field', () => {
  it('reads `backlog` three ways', () => {
    /*
     * SmartSuite *status* fields all share the same four workflow slugs, and
     * every table renames them. `backlog` alone is "Open", "Submitted" and "Not
     * Started" depending on which table you are reading — the single clearest
     * demonstration of why a global code→label map cannot exist.
     */
    expect(normalizeLegacyTicketStatus('backlog')).toBe('Open');
    expect(normalizeTimeOffStatus('backlog')).toBe('Submitted');
  });

  it('reads `complete` two ways', () => {
    expect(normalizeLegacyTicketStatus('complete')).toBe('Resolved');
    expect(normalizeTimeOffStatus('complete')).toBe('Cancelled');
  });
});

describe('policy status', () => {
  it('leaves the two undocumented codes alone rather than guessing', () => {
    /*
     * `1943j` and `4krtk` are in the migrated data but in no table doc —
     * choices added to SmartSuite after the docs were captured. Passthrough is
     * the honest answer: an operator can look the code up, whereas a guessed
     * status silently misreports a book. The migration report names them with
     * counts. When their meaning is known, add them above and delete this test.
     */
    expect(normalizePolicyStatus('1943j')).toBe('1943j');
    expect(normalizePolicyStatus('4krtk')).toBe('4krtk');
    expect(isActivePolicyStatus('1943j')).toBe(false);
  });

  it('answers the active question only for a known-active status', () => {
    expect(isActivePolicyStatus('QsrnM')).toBe(true);
    expect(isActivePolicyStatus('Active')).toBe(true);
    expect(isActivePolicyStatus('hLpfg')).toBe(false);
    expect(isActivePolicyStatus(null)).toBe(false);
  });
});

describe('household status', () => {
  it('answers the active question for the code the UI never matched', () => {
    // `HouseholdProfile.tsx` tested `/active/i` against a stored `b5qvJ`, so
    // every migrated household rendered as inactive.
    expect(isActiveHouseholdStatus('b5qvJ')).toBe(true);
    expect(isActiveHouseholdStatus('QmEth')).toBe(false);
    expect(isActiveHouseholdStatus(null)).toBe(false);
  });
});

describe('time-off vocabularies', () => {
  it.each([
    ['request type', TIME_OFF_REQUEST_TYPE_CODE_ALIASES, normalizeTimeOffRequestType],
    ['type', TIME_OFF_TYPE_CODE_ALIASES, normalizeTimeOffType],
    ['decision', TIME_OFF_DECISION_CODE_ALIASES, normalizeTimeOffDecision],
  ])('resolves every %s code', (_name, aliases, normalize) => {
    for (const [code, expected] of Object.entries(aliases)) {
      expect(normalize(code)).toBe(expected);
    }
  });

  it('trims the trailing space SmartSuite ships in "Unpaid "', () => {
    expect(normalizeTimeOffType('Aw0Xh')).toBe('Unpaid');
    expect(normalizeTimeOffType('Unpaid ')).toBe('Unpaid');
  });
});

describe('contact roles', () => {
  it('resolves every catalogued code', () => {
    for (const [code, expected] of Object.entries(
      HOUSEHOLD_ROLE_CODE_ALIASES,
    )) {
      expect(normalizeContactRole(code)).toBe(expected);
      expect(CONTACT_ROLES).toContain(expected);
    }
  });

  it('collapses both named-insured spellings onto one label', () => {
    // SmartSuite has `iqGZ5` "Name Insured" (sic) and `lzh7a` "Named Insured".
    // One concept, spelt twice; both must land on the label intake already
    // stamps, so a migrated primary and an app-created one agree.
    expect(normalizeContactRole('iqGZ5')).toBe(PRIMARY_HOUSEHOLD_ROLE);
    expect(normalizeContactRole('lzh7a')).toBe(PRIMARY_HOUSEHOLD_ROLE);
  });

  it('keeps Parent and Other storable but unofferable', () => {
    /*
     * They are real values a migrated contact carries, so they must round-trip
     * — but they are not form options, and `HOUSEHOLD_MEMBER_ROLES` drives the
     * New Lead dropdown. Widening that would add two options nobody asked for.
     */
    expect(normalizeContactRole('ZOVDs')).toBe('Parent');
    expect(HOUSEHOLD_MEMBER_ROLES).not.toContain('Parent');
    expect(HOUSEHOLD_MEMBER_ROLES).not.toContain('Other');
    expect(normalizeHouseholdRole('ZOVDs')).toBeNull();
    expect(normalizeHouseholdRole('SCJxW')).toBeNull();
  });

  it('resolves a code to a form role where one exists', () => {
    // The fix for `start-quote-prefill`, which used to prefill every migrated
    // contact as "Driver" because a raw code matched no canonical label.
    expect(normalizeHouseholdRole('W7qil')).toBe('Spouse');
    expect(normalizeHouseholdRole('fZHxn')).toBe('Child');
    expect(normalizeHouseholdRole('5ddmB')).toBe('Driver');
  });
});

describe('legacy ticket → CRM bridge', () => {
  it('lands every legacy status label on a real CRM status slug', () => {
    for (const label of LEGACY_TICKET_STATUSES) {
      const slug = toServiceTicketStatus(label);
      expect(SERVICE_TICKET_STATUSES as readonly string[]).toContain(slug);
      expect(LEGACY_TICKET_STATUS_SLUGS[label]).toBe(slug);
    }
  });

  it('bridges straight from a SmartSuite code, without a label in between', () => {
    expect(toServiceTicketStatus('backlog')).toBe('open');
    expect(toServiceTicketStatus('a2E7K')).toBe('waiting_on_carrier');
    expect(toServiceTicketStatus('r1Glf')).toBe('closed');
  });

  it('is idempotent over a slug, so a consolidation re-run is a no-op', () => {
    for (const slug of Object.values(LEGACY_TICKET_STATUS_SLUGS)) {
      expect(toServiceTicketStatus(slug)).toBe(slug);
    }
  });

  it('files a blank or unknown status as open', () => {
    // Five of the 286 migrated tickets carried no status at all.
    expect(toServiceTicketStatus('')).toBe('open');
    expect(toServiceTicketStatus(null)).toBe('open');
    expect(toServiceTicketStatus('Escalated')).toBe('open');
  });

  it('collapses four legacy priorities onto the CRM three', () => {
    expect(toServiceTicketPriority('Low')).toBe('low');
    expect(toServiceTicketPriority('medium')).toBe('medium');
    expect(toServiceTicketPriority('High')).toBe('high');
    expect(toServiceTicketPriority('Urgent')).toBe('high');
    for (const label of LEGACY_TICKET_PRIORITIES) {
      expect(SERVICE_TICKET_PRIORITIES as readonly string[]).toContain(
        toServiceTicketPriority(label),
      );
    }
  });

  it('defaults priority to medium, the same default the CRM applies', () => {
    expect(toServiceTicketPriority('')).toBe('medium');
    expect(toServiceTicketPriority(undefined)).toBe('medium');
    expect(toServiceTicketPriority('high')).toBe('high');
  });

  it('keeps every category, and files an unknown one under Other', () => {
    for (const category of SERVICE_TICKET_CATEGORIES) {
      expect(toServiceTicketCategory(category)).toBe(category);
    }
    expect(toServiceTicketCategory('4osEm')).toBe('Policy Change');
    expect(toServiceTicketCategory('Coverage Question')).toBe('Other');
    expect(toServiceTicketCategory('')).toBe('Other');
  });
});
