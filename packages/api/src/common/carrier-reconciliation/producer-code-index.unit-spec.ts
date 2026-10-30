import {
  bindIdStatus,
  creditFor,
  ProducerCodeIndex,
  type StaffCodes,
} from './producer-code-index';

const codes = new ProducerCodeIndex([
  { userId: 'u-pat', name: 'Pat Producer', bindId: 'SOKPAT01' },
  { userId: 'u-sam', name: 'Sam Seller', bindId: 'SOKSAM02' },
  { userId: 'u-new', name: 'New Hire', bindId: null },
] satisfies StaffCodes[]);

describe('bindIdStatus', () => {
  it.each([
    ['SOKPAT01', null, 'staff'],
    ['SOKPAT01', 'PAT PRODUCER', 'staff'],
    ['SOKSAM02', null, 'staff'],
    ['SOK35W06', 'BRIAN CARTER', 'former_staff'],
    ['OSCVANJ', null, 'not_staff'],
    ['SJM-RCM', null, 'not_staff'],
    [null, null, 'blank'],
  ])('%p named %p → %s', (bindIdKey, bindIdName, expected) => {
    expect(bindIdStatus({ bindIdKey, bindIdName }, codes)).toBe(expected);
  });
});

describe('creditFor', () => {
  const line = {
    bindIdKey: 'SOKSAM02' as string | null,
    bindIdName: 'SAM SELLER' as string | null,
  };

  it('credits the user whose Bind ID bound it, by the name the app knows them by', () => {
    expect(creditFor(line, codes)).toEqual({
      name: 'Sam Seller',
      userId: 'u-sam',
      via: 'bind_id',
    });
  });

  // Dash's sub-producer column is not read (owner, 28 Oct 2026): one person
  // would otherwise show twice — once by the code, once by their user.
  it('ignores the sub-producer Dash prints', () => {
    const dashLine = {
      ...line,
      subProducerCode: '034',
      subProducerName: 'PAT PRODUCER',
    };
    expect(creditFor(dashLine, codes)).toEqual({
      name: 'Sam Seller',
      userId: 'u-sam',
      via: 'bind_id',
    });
  });

  it('credits a former employee by the name Dash prints, with no user', () => {
    expect(
      creditFor({ bindIdKey: 'SOK35W06', bindIdName: 'BRIAN CARTER' }, codes),
    ).toEqual({ name: 'BRIAN CARTER', userId: null, via: 'bind_id' });
  });

  it('credits nobody for an unnamed login on no user, or no Bind ID', () => {
    expect(
      creditFor({ bindIdKey: 'OSCVANJ', bindIdName: null }, codes),
    ).toEqual({ name: null, userId: null, via: 'none' });
    expect(
      creditFor({ bindIdKey: null, bindIdName: 'BRIAN CARTER' }, codes),
    ).toEqual({ name: null, userId: null, via: 'none' });
  });
});
