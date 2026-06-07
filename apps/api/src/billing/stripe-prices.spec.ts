import { stripePriceFor } from './stripe-prices';

test('maps plan ids to configured Stripe price ids', () => {
  const env = { STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_SCALE: 'price_scale' };
  expect(stripePriceFor('pro', env)).toBe('price_pro');
  expect(stripePriceFor('scale', env)).toBe('price_scale');
});

test('free has no price (cannot be checked out)', () => {
  expect(stripePriceFor('free', {})).toBe('');
});

test('unknown plan has no price', () => {
  expect(stripePriceFor('enterprise', { STRIPE_PRICE_PRO: 'price_pro' })).toBe('');
});
