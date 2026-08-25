import { completionPercent } from './audit-counters';

/**
 * The completion percentage the drawer shows at the top of a deal (PAC-72
 * section A item 3) — the figure that replaced David's rejected checkmarks.
 */
describe('completionPercent', () => {
  it('is the resolved share of the checklist', () => {
    expect(completionPercent({ itemCount: 4, resolvedCount: 1 })).toBe(25);
    expect(completionPercent({ itemCount: 4, resolvedCount: 4 })).toBe(100);
  });

  it('rounds to a whole number', () => {
    // 2/3 — the drawer has no room for decimals and nobody reads them.
    expect(completionPercent({ itemCount: 3, resolvedCount: 2 })).toBe(67);
  });

  it('reads an empty checklist as complete, not as zero', () => {
    // A deal that required no documents has nothing outstanding. Rendering
    // "0% complete" would send the service team chasing a client for nothing —
    // and a plain `resolved / total` would also divide by zero.
    expect(completionPercent({ itemCount: 0, resolvedCount: 0 })).toBe(100);
  });

  it('clamps to 0–100 on inconsistent counters', () => {
    // Counters are denormalized and can drift between a resolve and the next
    // recompute. A progress bar rendering 250% is a visible bug in a place
    // nobody would think to look for one.
    expect(completionPercent({ itemCount: 2, resolvedCount: 5 })).toBe(100);
    expect(completionPercent({ itemCount: 4, resolvedCount: -2 })).toBe(0);
    expect(completionPercent({ itemCount: -1, resolvedCount: 0 })).toBe(100);
  });
});
