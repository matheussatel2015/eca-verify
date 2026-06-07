import { StripeAdapter } from './stripe-adapter';

function fakeStripe(overrides: any = {}) {
  return {
    checkout: { sessions: { create: jest.fn(async (_args: any) => ({ url: 'https://checkout.stripe/abc' })) } },
    webhooks: { constructEvent: jest.fn() },
    ...overrides,
  };
}
const cfg = { webhookSecret: 'whsec', successUrl: 'http://s', cancelUrl: 'http://c', priceFor: (p: string) => (p === 'pro' ? 'price_pro' : '') };

test('createCheckout creates a subscription session with client_reference_id + metadata', async () => {
  const stripe = fakeStripe();
  const a = new StripeAdapter(stripe as any, cfg);
  const r = await a.createCheckout({ tenantId: 'ten1', planId: 'pro' });
  expect(r.url).toBe('https://checkout.stripe/abc');
  const args = stripe.checkout.sessions.create.mock.calls[0][0];
  expect(args.mode).toBe('subscription');
  expect(args.client_reference_id).toBe('ten1');
  expect(args.metadata).toEqual({ tenantId: 'ten1', planId: 'pro' });
  expect(args.subscription_data.metadata.tenantId).toBe('ten1');
  expect(args.line_items[0].price).toBe('price_pro');
});

test('createCheckout throws when the plan has no Stripe price', async () => {
  const a = new StripeAdapter(fakeStripe() as any, cfg);
  await expect(a.createCheckout({ tenantId: 'ten1', planId: 'free' })).rejects.toThrow(/price/i);
});

test('resolveWebhook maps checkout.session.completed to a plan change', async () => {
  const stripe = fakeStripe();
  stripe.webhooks.constructEvent.mockReturnValue({
    type: 'checkout.session.completed',
    data: { object: { client_reference_id: 'ten1', metadata: { planId: 'pro' }, customer: 'cus_1', subscription: 'sub_1' } },
  });
  const a = new StripeAdapter(stripe as any, cfg);
  const change = await a.resolveWebhook(Buffer.from('{}'), 'sig');
  expect(change).toEqual({ tenantId: 'ten1', planId: 'pro', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
});

test('resolveWebhook maps subscription deletion to a downgrade to free', async () => {
  const stripe = fakeStripe();
  stripe.webhooks.constructEvent.mockReturnValue({
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', metadata: { tenantId: 'ten1' } } },
  });
  const a = new StripeAdapter(stripe as any, cfg);
  expect(await a.resolveWebhook(Buffer.from('{}'), 'sig')).toEqual({ tenantId: 'ten1', planId: 'free', stripeSubscriptionId: 'sub_1' });
});

test('resolveWebhook returns null for unrelated events', async () => {
  const stripe = fakeStripe();
  stripe.webhooks.constructEvent.mockReturnValue({ type: 'invoice.paid', data: { object: {} } });
  const a = new StripeAdapter(stripe as any, cfg);
  expect(await a.resolveWebhook(Buffer.from('{}'), 'sig')).toBeNull();
});
