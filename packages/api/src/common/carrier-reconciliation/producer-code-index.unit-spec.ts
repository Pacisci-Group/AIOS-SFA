import {
  bindIdStatus,
  creditFor,
  ProducerCodeIndex,
  type StaffCodes,
} from './producer-code-index';

const codes = new ProducerCodeIndex([
  {
    userId: 'u-pat',
    name: 'Pat Producer',
    bindId: 'SOKPAT01',
    subProducerCode: '034',
  },
  {
    userId: 'u-sam',
    name: 'Sam Seller',
    bindId: 'SOKSAM02',
    subProducerCode: null,
  },
  { userId: 'u-new', name: 'New Hire', bindId: null, subProducerCode: '041' },
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
    subProducerCode: null as string | null,
    subProducerName: null as string | null,
    bindIdKey: 'SOKSAM02' as string | null,
    bindIdName: 'SAM SELLER' as string | null,
  };

  it('credits the sub-producer over whoever bound it', () => {
    expect(
      creditFor(
        { ...line, subProducerCode: '034', subProducerName: 'PAT P' },
        codes,
      ),
    ).toEqual({
      code: '034',
      name: 'PAT P',
      userId: 'u-pat',
      via: 'sub_producer',
    });
  });

  it('names the code’s holder when Dash prints no name', () => {
    expect(creditFor({ ...line, subProducerCode: '041' }, codes)).toEqual({
      code: '041',
      name: 'New Hire',
      userId: 'u-new',
      via: 'sub_producer',
    });
  });

  it('does not fall back to the binder when the sub-producer code is on nobody', () => {
    expect(
      creditFor(
        { ...line, subProducerCode: '002', subProducerName: 'BRIAN C' },
        codes,
      ),
    ).toEqual({
      code: '002',
      name: 'BRIAN C',
      userId: null,
      via: 'sub_producer',
    });
  });

  it('credits the binder when the line names no sub-producer', () => {
    expect(creditFor(line, codes)).toEqual({
      code: null,
      name: 'SAM SELLER',
      userId: 'u-sam',
      via: 'bind_id',
    });
  });

  it('credits a former employee by the name Dash prints, with no user', () => {
    expect(
      creditFor(
        { ...line, bindIdKey: 'SOK35W06', bindIdName: 'BRIAN CARTER' },
        codes,
      ),
    ).toEqual({
      code: null,
      name: 'BRIAN CARTER',
      userId: null,
      via: 'bind_id',
    });
  });

  it('credits nobody for an unnamed login on no user', () => {
    expect(
      creditFor({ ...line, bindIdKey: 'OSCVANJ', bindIdName: null }, codes),
    ).toEqual({ code: null, name: null, userId: null, via: 'none' });
  });
});
