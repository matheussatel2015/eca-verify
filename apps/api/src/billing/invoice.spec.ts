import { buildInvoice } from './invoice';
import { PLANS } from './plans';

test('builds an invoice with remaining and within_quota', () => {
  const inv = buildInvoice(PLANS.free, 40, '2026-06');
  expect(inv).toEqual({
    period: '2026-06', plan_id: 'free', plan_name: 'Free',
    monthly_price_cents: 0, quota: 100, used: 40, remaining: 60, within_quota: true,
  });
});

test('clamps remaining at zero and flags over-quota', () => {
  const inv = buildInvoice(PLANS.free, 130, '2026-06');
  expect(inv.remaining).toBe(0);
  expect(inv.within_quota).toBe(false);
});
