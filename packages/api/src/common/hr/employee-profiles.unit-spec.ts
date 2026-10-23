import { assignmentAsOf } from './employee-profiles.service';

describe('assignmentAsOf (PAC-162)', () => {
  const history = [
    { effectiveFrom: '2026-01-10', tag: 'first' },
    { effectiveFrom: '2026-06-01', tag: 'second' },
    { effectiveFrom: '2026-06-01', tag: 'same-day-correction' },
    { effectiveFrom: '2026-09-15', tag: 'third' },
  ];

  it('returns the entry in force on the day', () => {
    expect(assignmentAsOf(history, '2026-03-01')?.tag).toBe('first');
    expect(assignmentAsOf(history, '2026-07-01')?.tag).toBe(
      'same-day-correction',
    );
    expect(assignmentAsOf(history, '2026-12-31')?.tag).toBe('third');
  });

  it('takes the later of two same-day entries, and the entry on its own day', () => {
    expect(assignmentAsOf(history, '2026-06-01')?.tag).toBe(
      'same-day-correction',
    );
    expect(assignmentAsOf(history, '2026-09-15')?.tag).toBe('third');
  });

  it('falls back to the first entry before any history, and null with none', () => {
    expect(assignmentAsOf(history, '2025-01-01')?.tag).toBe('first');
    expect(assignmentAsOf([], '2026-01-01')).toBeNull();
  });
});
