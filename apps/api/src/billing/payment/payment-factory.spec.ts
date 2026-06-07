import { buildPaymentProvider } from './payment-factory';
import { MockPaymentProvider } from './mock-payment';
import { StripeAdapter } from './stripe-adapter';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

test('returns the mock provider by default', () => {
  expect(buildPaymentProvider({ kind: 'mock' } as any, {})).toBeInstanceOf(MockPaymentProvider);
});

test('throws when building the mock provider in production', () => {
  process.env.NODE_ENV = 'production';
  expect(() => buildPaymentProvider({ kind: 'mock' } as any, {})).toThrow(/MockPaymentProvider must not run in production/);
});

test('returns the Stripe adapter when kind=stripe with a key', () => {
  const p = buildPaymentProvider(
    { kind: 'stripe', stripeSecretKey: 'sk_test_x', stripeWebhookSecret: 'whsec', successUrl: 's', cancelUrl: 'c' } as any,
    { STRIPE_PRICE_PRO: 'price_pro' },
  );
  expect(p).toBeInstanceOf(StripeAdapter);
});

test('throws when kind=stripe without a secret key', () => {
  expect(() => buildPaymentProvider({ kind: 'stripe', stripeSecretKey: '' } as any, {})).toThrow(/STRIPE_SECRET_KEY/);
});
