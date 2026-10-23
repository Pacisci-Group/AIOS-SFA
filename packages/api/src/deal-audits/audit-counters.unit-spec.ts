import { isProducerActionable } from '@sfa/shared';
import { IS_PRODUCER_ACTIONABLE, completionPercent } from './audit-counters';

/**
 * Just enough of Mongo's aggregation-expression semantics to evaluate
 * `IS_PRODUCER_ACTIONABLE` without a database: `$or`, `$and`, `$eq`, `$ne`, and
 * `'$field'` references. A missing field evaluates to `undefined`, which —
 * as in Mongo — is `$ne` to `false` and not `$eq` to `'fail'`.
 */
function evaluate(expr: unknown, doc: Record<string, unknown>): unknown {
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return doc[expr.slice(1)];
  }
  if (expr === null || typeof expr !== 'object' || Array.isArray(expr)) {
    return expr;
  }
  const [op, args] = Object.entries(expr)[0] as [string, unknown[]];
  const values = args.map((arg) => evaluate(arg, doc));
  switch (op) {
    case '$or':
      return values.some(Boolean);
    case '$and':
      return values.every(Boolean);
    case '$eq':
      return values[0] === values[1];
    case '$ne':
      return values[0] !== values[1];
    default:
      throw new Error(`evaluate: unsupported operator ${op}`);
  }
}

/**
 * The producer board's filter lives twice — the shared helper (the web and the
 * service) and this aggregation expression (the stored counters). If they
 * disagreed, a card's "3 of 5 outstanding" would not match the rows its drawer
 * lists.
 */
describe('IS_PRODUCER_ACTIONABLE', () => {
  const visibilities = [true, false, null, undefined] as const;
  const verdicts = ['pass', 'fail', null, undefined] as const;

  for (const producerVisible of visibilities) {
    for (const reviewVerdict of verdicts) {
      it(`agrees with isProducerActionable for producerVisible=${String(producerVisible)}, verdict=${String(reviewVerdict)}`, () => {
        const doc: Record<string, unknown> = {};
        if (producerVisible !== undefined)
          doc.producerVisible = producerVisible;
        if (reviewVerdict !== undefined) doc.reviewVerdict = reviewVerdict;

        expect(Boolean(evaluate(IS_PRODUCER_ACTIONABLE, doc))).toBe(
          isProducerActionable({ producerVisible, reviewVerdict }),
        );
      });
    }
  }
});

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
