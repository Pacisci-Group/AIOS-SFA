import { dashProductPolicyType } from './dash-product-map';

describe('dashProductPolicyType', () => {
  it.each([
    ['Standard Auto', 'Auto'],
    ['Non Standard Auto', 'Auto'],
    ['Non-Standard Auto', 'Auto'],
    ['Specialty Auto', 'Auto - Special'],
    ['Homeowners', 'Home'],
    ['Renters', 'Renters'],
    ['Landlords', 'Landlord'],
    ['Inland Marine Boatowners', 'Boat Owners'],
    ['Personal Umbrella Policy', 'Umbrella'],
    ['Valuable Items Protection', 'Valuable Item Protection'],
    ['  HOMEOWNERS ', 'Home'],
  ])('maps the Dash product %p to %p', (product, expected) => {
    expect(dashProductPolicyType(product, null)).toBe(expected);
  });

  it('takes a product named exactly as an app policy type, in any case', () => {
    expect(dashProductPolicyType('condominium', null)).toBe('Condominium');
    expect(dashProductPolicyType('AUTO - SPECIAL', null)).toBe(
      'Auto - Special',
    );
    expect(dashProductPolicyType('Motorcycle', null)).toBe('Motorcycle');
  });

  it('reads the description when the product names nothing', () => {
    expect(dashProductPolicyType(null, 'Homeowners')).toBe('Home');
    expect(dashProductPolicyType('Personal Lines', 'Renters')).toBe('Renters');
  });

  it('prefers the product over the description', () => {
    expect(dashProductPolicyType('Specialty Auto', 'Standard Auto')).toBe(
      'Auto - Special',
    );
  });

  it.each([
    ['Motor Club', null],
    ['Commercial Auto', null],
    ['', ''],
    [null, null],
    [undefined, undefined],
  ])('is null for %p / %p, so the form asks', (product, description) => {
    expect(dashProductPolicyType(product, description)).toBeNull();
  });
});
