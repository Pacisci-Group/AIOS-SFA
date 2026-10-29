import { splitDashCustomerName } from './dash-customer-name';

describe('splitDashCustomerName', () => {
  it.each([
    [
      'JACQUELINE BANUELOS MURILLO',
      { firstName: 'Jacqueline', lastName: 'Banuelos Murillo' },
    ],
    ['CASEY CUSTOMER', { firstName: 'Casey', lastName: 'Customer' }],
    ["SEAN O'NEIL", { firstName: 'Sean', lastName: "O'Neil" }],
    ['ANNA SMITH-JONES', { firstName: 'Anna', lastName: 'Smith-Jones' }],
    ['MARY-KATE OLSEN', { firstName: 'Mary-Kate', lastName: 'Olsen' }],
    ['  JOSÉ   ÁLVAREZ  ', { firstName: 'José', lastName: 'Álvarez' }],
    ['jane doe', { firstName: 'Jane', lastName: 'Doe' }],
  ])('splits %p', (raw, expected) => {
    expect(splitDashCustomerName(raw)).toEqual(expected);
  });

  it('reads a single token as a first name, leaving the last name to the form', () => {
    expect(splitDashCustomerName('MADONNA')).toEqual({
      firstName: 'Madonna',
      lastName: '',
    });
  });

  it.each([[''], ['   '], [null], [undefined]])(
    'is null for %p — nothing to prefill',
    (raw) => {
      expect(splitDashCustomerName(raw)).toBeNull();
    },
  );
});
