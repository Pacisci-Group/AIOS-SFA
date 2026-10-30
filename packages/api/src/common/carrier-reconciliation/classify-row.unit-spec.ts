import { classifyDashRow, isDirectChannel } from './classify-row';

const row = (
  transactionType: string,
  dispositionCode: string | null = 'New Policy Issued',
  product = 'Homeowners',
) => ({
  transactionType,
  dispositionCode,
  product,
  productDescription: product,
});

describe('classifyDashRow', () => {
  it.each([
    ['New Issued Transaction - First Term'],
    ['Sales Issued'],
    ['  sales   issued '],
  ])('counts %p with a New Policy Issued disposition as a sale', (type) => {
    expect(classifyDashRow(row(type))).toEqual({
      isSale: true,
      ignoredReason: null,
    });
  });

  it('ignores an item added to an existing policy', () => {
    expect(
      classifyDashRow(
        row('Endorsement - Add Item/Premium - First Term', 'Add Item'),
      ),
    ).toEqual({ isSale: false, ignoredReason: 'endorsement' });
  });

  it('ignores a Sales Issued line whose disposition is not a new policy', () => {
    expect(classifyDashRow(row('Sales Issued', 'Add Item'))).toEqual({
      isSale: false,
      ignoredReason: 'not_new_policy',
    });
  });

  it('ignores Motor Club whatever its transaction', () => {
    expect(
      classifyDashRow(
        row('New Issued Transaction - First Term', undefined, 'Motor Club'),
      ),
    ).toEqual({ isSale: false, ignoredReason: 'motor_club' });
  });
});

describe('isDirectChannel', () => {
  it.each([
    ['1-800', true],
    ['Allstate.com', true],
    ['Agency', false],
    ['Agency Call Forward', false],
    [null, false],
  ])('%p → %p', (channel, expected) => {
    expect(isDirectChannel(channel)).toBe(expected);
  });
});
