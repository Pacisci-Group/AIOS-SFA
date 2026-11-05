import {
  createTimeOffRequestSchema,
  listMyTimeOffRequestsSchema,
  listTeamTimeOffRequestsSchema,
  submitTimeOffRequestSchema,
  timeOffNoteRequiredSchema,
  timeOffRequestSchema,
} from './time-off.dto';

const POLICY = '68f3c0ffee0000000000c210';
const body = (over: Record<string, unknown> = {}) => ({
  policyId: POLICY,
  firstDay: '2026-11-12',
  lastDay: '2026-11-14',
  dayMode: 'full',
  ...over,
});

describe('time off request DTOs (PAC-165)', () => {
  it('accepts the four inputs, and a single day as a range of one', () => {
    expect(timeOffRequestSchema.safeParse(body()).success).toBe(true);
    expect(
      timeOffRequestSchema.safeParse(body({ lastDay: '2026-11-12' })).success,
    ).toBe(true);
  });

  it('refuses a day that is not one, and a range back to front', () => {
    expect(
      timeOffRequestSchema.safeParse(body({ firstDay: '2026-02-30' })).success,
    ).toBe(false);
    expect(
      timeOffRequestSchema.safeParse(body({ firstDay: '11/12/2026' })).success,
    ).toBe(false);
    const backwards = timeOffRequestSchema.safeParse(
      body({ firstDay: '2026-11-14', lastDay: '2026-11-12' }),
    );
    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0].path).toEqual(['lastDay']);
  });

  it('takes partial-day hours in quarter hours, 0 to 24, keyed by real dates', () => {
    const partial = (hours: unknown) =>
      timeOffRequestSchema.safeParse(body({ dayMode: 'partial', hours }))
        .success;
    expect(partial({ '2026-11-12': 2.5, '2026-11-13': 0 })).toBe(true);
    expect(partial({ '2026-11-12': 0.75 })).toBe(true);
    expect(partial({ '2026-11-12': 2.1 })).toBe(false);
    expect(partial({ '2026-11-12': -1 })).toBe(false);
    expect(partial({ '2026-11-12': 25 })).toBe(false);
    expect(partial({ 'next tuesday': 4 })).toBe(false);
  });

  it('reports an emptied note as null and caps its length', () => {
    const parsed = timeOffRequestSchema.parse(body({ note: '   ' }));
    expect(parsed.note).toBeNull();
    expect(
      timeOffRequestSchema.safeParse(body({ note: 'x'.repeat(1001) })).success,
    ).toBe(false);
  });

  it('needs `send` on create, so a draft is never an accident', () => {
    expect(createTimeOffRequestSchema.safeParse(body()).success).toBe(false);
    expect(
      createTimeOffRequestSchema.safeParse(body({ send: false })).success,
    ).toBe(true);
  });

  it('submits the edited form or nothing at all — never half of one', () => {
    expect(submitTimeOffRequestSchema.safeParse({}).success).toBe(true);
    expect(submitTimeOffRequestSchema.safeParse(body()).success).toBe(true);
    expect(
      submitTimeOffRequestSchema.safeParse({ firstDay: '2026-11-12' }).success,
    ).toBe(false);
  });

  it('requires the note where the lifecycle does', () => {
    expect(timeOffNoteRequiredSchema.safeParse({}).success).toBe(false);
    expect(timeOffNoteRequiredSchema.safeParse({ note: '  ' }).success).toBe(
      false,
    );
    expect(
      timeOffNoteRequiredSchema.parse({ note: ' Too many off ' }).note,
    ).toBe('Too many off');
  });

  it('reads the group facet as one value or many, and never offers a team draft', () => {
    expect(listMyTimeOffRequestsSchema.parse({ group: 'draft' }).group).toEqual(
      ['draft'],
    );
    expect(
      listTeamTimeOffRequestsSchema.parse({ group: ['pending', 'taken'] })
        .group,
    ).toEqual(['pending', 'taken']);
    expect(
      listTeamTimeOffRequestsSchema.safeParse({ group: 'draft' }).success,
    ).toBe(false);
    expect(listTeamTimeOffRequestsSchema.parse({}).pageSize).toBe(25);
  });
});
