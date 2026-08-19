import {
  ChangeFieldSpec,
  changeDate,
  changeText,
  diffSnapshots,
  snapshot,
} from './change-log';

interface Doc {
  premium?: number;
  carrier?: string;
  effectiveDate?: Date;
  productsQuoted?: string[];
  notes?: string;
}

const SPECS: ChangeFieldSpec<Doc>[] = [
  {
    field: 'premium',
    label: 'Premium',
    kind: 'currency',
    read: (d) => d.premium ?? null,
  },
  {
    field: 'carrier',
    label: 'Carrier',
    kind: 'text',
    read: (d) => d.carrier ?? null,
  },
  {
    field: 'effectiveDate',
    label: 'Effective date',
    kind: 'date',
    read: (d) => changeDate(d.effectiveDate),
  },
  {
    field: 'productsQuoted',
    label: 'Policy types',
    kind: 'list',
    read: (d) => d.productsQuoted ?? null,
  },
  {
    field: 'notes',
    label: 'Notes',
    kind: 'text',
    read: (d) => changeText(d.notes),
  },
];

const diff = (before: Doc, after: Doc) =>
  diffSnapshots(SPECS, snapshot(SPECS, before), snapshot(SPECS, after));

describe('change-log', () => {
  it('reports nothing when nothing moved', () => {
    const doc: Doc = { premium: 1200, carrier: 'Allstate' };
    expect(diff(doc, { ...doc })).toEqual([]);
  });

  it('reports a changed field with both sides and its kind', () => {
    expect(diff({ premium: 1200 }, { premium: 1400 })).toEqual([
      {
        field: 'premium',
        label: 'Premium',
        kind: 'currency',
        from: 1200,
        to: 1400,
      },
    ]);
  });

  it('preserves cents rather than rounding to dollars', () => {
    // The reason the timeline cannot reuse `formatCurrency`, which is
    // `maximumFractionDigits: 0` — a 40c correction must not read "$900 → $900".
    const [change] = diff({ premium: 900 }, { premium: 900.4 });
    expect(change.from).toBe(900);
    expect(change.to).toBe(900.4);
  });

  it('reports a cleared field as null, not as absent', () => {
    expect(diff({ carrier: 'Allstate' }, {})).toEqual([
      {
        field: 'carrier',
        label: 'Carrier',
        kind: 'text',
        from: 'Allstate',
        to: null,
      },
    ]);
  });

  it('treats undefined and null as the same absence', () => {
    expect(diff({}, { carrier: undefined })).toEqual([]);
  });

  it('stores a date as YYYY-MM-DD, never as an instant', () => {
    const [change] = diff(
      { effectiveDate: new Date('2026-02-01T00:00:00.000Z') },
      { effectiveDate: new Date('2026-03-01T00:00:00.000Z') },
    );
    expect(change.from).toBe('2026-02-01');
    expect(change.to).toBe('2026-03-01');
  });

  it('ignores list reordering', () => {
    // `productsQuoted` is derived through a Set over the policy rows, so moving
    // a row reorders it without anything having changed.
    expect(
      diff(
        { productsQuoted: ['Auto', 'Home'] },
        { productsQuoted: ['Home', 'Auto'] },
      ),
    ).toEqual([]);
  });

  it('reports a genuine list change', () => {
    const [change] = diff(
      { productsQuoted: ['Auto'] },
      { productsQuoted: ['Auto', 'Home'] },
    );
    expect(change.from).toEqual(['Auto']);
    expect(change.to).toEqual(['Auto', 'Home']);
  });

  it('truncates long free text on both sides', () => {
    const long = 'x'.repeat(300);
    const [change] = diff({ notes: 'short' }, { notes: long });
    expect(change.to).toHaveLength(121);
    expect(change.to).toMatch(/…$/);
  });

  it('reports every changed field in spec order, and only those', () => {
    const changes = diff(
      { premium: 1200, carrier: 'Allstate' },
      { premium: 1400, carrier: 'Allstate', notes: 'Re-rated' },
    );
    expect(changes.map((c) => c.field)).toEqual(['premium', 'notes']);
  });
});

describe('changeText', () => {
  it('treats whitespace-only as absent', () => {
    expect(changeText('   ')).toBeNull();
  });

  it('leaves text at the limit alone', () => {
    const exact = 'y'.repeat(120);
    expect(changeText(exact)).toBe(exact);
  });
});
