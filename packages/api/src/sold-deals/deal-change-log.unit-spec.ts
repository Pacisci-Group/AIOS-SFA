import { diffSnapshots, snapshot } from '../activities/change-log';
import {
  DEAL_CHANGE_FIELDS,
  policyChangeLabel,
  type DealChangeSubject,
} from './deal-change-log';

const AUTO = { policyType: 'Auto', policyNumber: '1789062605977' };
const HOME = { policyType: 'Home', policyNumber: '1789062605978' };

function subject(
  deal: Partial<DealChangeSubject['deal']> = {},
  policies: DealChangeSubject['policies'] = [AUTO],
): DealChangeSubject {
  return {
    deal: {
      soldDate: new Date('2026-02-15T00:00:00.000Z'),
      premium: 1276,
      itemCount: 3,
      dealType: 'Auto',
      ...deal,
    },
    policies,
  };
}

const diff = (before: DealChangeSubject, after: DealChangeSubject) =>
  diffSnapshots(
    DEAL_CHANGE_FIELDS,
    snapshot(DEAL_CHANGE_FIELDS, before),
    snapshot(DEAL_CHANGE_FIELDS, after),
  );

describe('deal change log (PAC-104)', () => {
  it('logs a sold-date correction as a calendar date, and nothing else', () => {
    const changes = diff(
      subject(),
      subject({ soldDate: new Date('2026-02-12T00:00:00.000Z') }),
    );

    expect(changes).toEqual([
      {
        field: 'soldDate',
        label: 'Sold date',
        kind: 'date',
        from: '2026-02-15',
        to: '2026-02-12',
      },
    ]);
  });

  it('logs an added policy together with the totals it moved', () => {
    const changes = diff(
      subject(),
      subject({ premium: 2176, itemCount: 4, dealType: 'Bundle' }, [
        AUTO,
        HOME,
      ]),
    );

    expect(changes.map((change) => change.field)).toEqual([
      'policies',
      'premium',
      'itemCount',
      'dealType',
    ]);
    expect(changes[0]).toMatchObject({
      kind: 'list',
      from: ['Auto 1789062605977'],
      to: ['Auto 1789062605977', 'Home 1789062605978'],
    });
    expect(changes[1]).toMatchObject({
      kind: 'currency',
      from: 1276,
      to: 2176,
    });
    expect(changes[3]).toMatchObject({ from: 'Auto', to: 'Bundle' });
  });

  it('does not report the same policies in another order as a change', () => {
    expect(diff(subject({}, [AUTO, HOME]), subject({}, [HOME, AUTO]))).toEqual(
      [],
    );
  });

  it('labels a policy by type and number, falling back when either is missing', () => {
    expect(
      policyChangeLabel({ policyType: 'Home', policyNumber: ' 42 ' }),
    ).toBe('Home 42');
    expect(policyChangeLabel({ policyNumber: '42' })).toBe('Policy 42');
    expect(policyChangeLabel({})).toBe('Policy');
  });
});
