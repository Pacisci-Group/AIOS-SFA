import {
  DEFAULT_ONBOARDING_STEP_DEFINITIONS,
  FINAL_ONBOARDING_STEP,
  nextOnboardingStep,
  ONBOARDING_CHECKLIST_KEYS,
  ONBOARDING_CHECKLIST_LABELS,
  ONBOARDING_EMAIL_MILESTONE_KEYS,
  ONBOARDING_EMAIL_MILESTONE_LABELS,
  ONBOARDING_STEP_CHECKLIST,
  ONBOARDING_STEP_KEYS,
  ONBOARDING_STEP_LABELS,
  SERVICE_TICKET_CATEGORIES,
  SERVICE_TICKET_STATUSES,
} from './service-ticket';

/**
 * Guardrails for the onboarding vocabulary. The load-bearing one is the first
 * test: onboarding progress must never leak into the ticket status enum, since
 * the KPI strip, feed tabs, and archive window all read that field.
 */
describe('onboarding vocabulary', () => {
  it('does not add onboarding steps to the ticket status enum', () => {
    for (const stepKey of ONBOARDING_STEP_KEYS) {
      expect(SERVICE_TICKET_STATUSES as readonly string[]).not.toContain(
        stepKey,
      );
    }
    // The four statuses onboarding derives into, and nothing new.
    for (const status of ['open', 'waiting', 'resolved', 'overdue']) {
      expect(SERVICE_TICKET_STATUSES as readonly string[]).toContain(status);
    }
  });

  it('is reachable as a ticket category', () => {
    expect(SERVICE_TICKET_CATEGORIES as readonly string[]).toContain(
      'Onboarding',
    );
  });

  it('is exactly three calls, in order', () => {
    expect(ONBOARDING_STEP_KEYS).toEqual([
      'welcome_call',
      'checkin_3day',
      'checkin_30day',
    ]);
  });

  it('no longer treats the Google review as a step', () => {
    // The owner folded it into the 30-day call; it survives as a checklist item.
    expect(ONBOARDING_STEP_KEYS as readonly string[]).not.toContain(
      'google_review',
    );
    expect(ONBOARDING_CHECKLIST_KEYS as readonly string[]).toContain(
      'googleReviewRequested',
    );
    expect(ONBOARDING_STEP_CHECKLIST.checkin_30day).toContain(
      'googleReviewRequested',
    );
  });

  it('labels every step, checklist item, and email milestone', () => {
    for (const key of ONBOARDING_STEP_KEYS) {
      expect(ONBOARDING_STEP_LABELS[key]).toBeTruthy();
    }
    for (const key of ONBOARDING_CHECKLIST_KEYS) {
      expect(ONBOARDING_CHECKLIST_LABELS[key]).toBeTruthy();
    }
    for (const key of ONBOARDING_EMAIL_MILESTONE_KEYS) {
      expect(ONBOARDING_EMAIL_MILESTONE_LABELS[key]).toBeTruthy();
    }
  });

  it('assigns every checklist item to exactly one call', () => {
    const assigned = ONBOARDING_STEP_KEYS.flatMap(
      (key) => ONBOARDING_STEP_CHECKLIST[key],
    );
    expect(new Set(assigned).size).toBe(assigned.length);
    expect([...assigned].sort()).toEqual([...ONBOARDING_CHECKLIST_KEYS].sort());
  });
});

describe('chain traversal', () => {
  it('walks the chain and terminates', () => {
    expect(nextOnboardingStep('welcome_call')).toBe('checkin_3day');
    expect(nextOnboardingStep('checkin_3day')).toBe('checkin_30day');
    expect(nextOnboardingStep('checkin_30day')).toBeNull();
  });

  it('names the step that ends the onboarding', () => {
    expect(FINAL_ONBOARDING_STEP).toBe(
      ONBOARDING_STEP_KEYS[ONBOARDING_STEP_KEYS.length - 1],
    );
    expect(nextOnboardingStep(FINAL_ONBOARDING_STEP)).toBeNull();
  });
});

describe('default step definitions', () => {
  it('defines exactly one entry per step key, in order', () => {
    const defined = DEFAULT_ONBOARDING_STEP_DEFINITIONS.map((d) => d.stepKey);
    expect(defined).toEqual([...ONBOARDING_STEP_KEYS]);
    expect(new Set(defined).size).toBe(defined.length);
  });

  it('assigns a contiguous sortOrder matching the key order', () => {
    DEFAULT_ONBOARDING_STEP_DEFINITIONS.forEach((definition, index) => {
      expect(definition.sortOrder).toBe(index);
    });
  });

  it('opens the welcome call the moment onboarding starts', () => {
    const [first] = DEFAULT_ONBOARDING_STEP_DEFINITIONS;
    expect(first.stepKey).toBe('welcome_call');
    expect(first.anchor).toBe('onboarding_start');
    expect(first.offsetMinutes).toBe(0);
  });

  it('anchors the 3-day check-in to the previous call', () => {
    const threeDay = DEFAULT_ONBOARDING_STEP_DEFINITIONS.find(
      (d) => d.stepKey === 'checkin_3day',
    );
    expect(threeDay?.anchor).toBe('previous_step');
    expect(threeDay?.offsetMinutes).toBe(3 * 24 * 60);
  });

  it('anchors the 30-day check-in to the start so it cannot drift', () => {
    const thirtyDay = DEFAULT_ONBOARDING_STEP_DEFINITIONS.find(
      (d) => d.stepKey === 'checkin_30day',
    );
    expect(thirtyDay?.anchor).toBe('onboarding_start');
    expect(thirtyDay?.offsetMinutes).toBe(30 * 24 * 60);
  });

  it('gives every step a positive SLA', () => {
    for (const definition of DEFAULT_ONBOARDING_STEP_DEFINITIONS) {
      expect(definition.slaMinutes).toBeGreaterThan(0);
    }
  });
});
