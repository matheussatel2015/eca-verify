import { MockPaymentProvider } from './mock-payment';

test('createCheckout returns a deterministic mock URL with tenant + plan', async () => {
  const p = new MockPaymentProvider();
  const r = await p.createCheckout({ tenantId: 'ten1', planId: 'pro' });
  expect(r.url).toContain('ten1');
  expect(r.url).toContain('pro');
});

test('resolveWebhook parses a JSON test payload into a SubscriptionChange', async () => {
  const p = new MockPaymentProvider();
  const body = Buffer.from(JSON.stringify({ tenantId: 'ten1', planId: 'scale' }));
  expect(await p.resolveWebhook(body, 'ignored')).toEqual({ tenantId: 'ten1', planId: 'scale' });
});

test('resolveWebhook returns null for an unparseable body', async () => {
  const p = new MockPaymentProvider();
  expect(await p.resolveWebhook(Buffer.from('nope'), '')).toBeNull();
});
