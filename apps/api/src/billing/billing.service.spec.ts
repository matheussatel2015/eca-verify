import { BillingService } from './billing.service';
import { HttpException } from '@nestjs/common';
import { isValidPlanId } from './plans';

void isValidPlanId;

function deps(tenant: any, used: number) {
  const tenants = { findOneOrFail: jest.fn(async () => tenant), update: jest.fn(async () => ({ affected: 1 })) };
  let counter = used;
  const usage = {
    current: jest.fn(async () => counter),
    increment: jest.fn(async () => ++counter),
    incrementAndCheck: jest.fn(async (_tenantId: string, limit: number) => {
      const n = counter + 1;
      if (n > limit) return { allowed: false, used: counter };
      counter = n;
      return { allowed: true, used: n };
    }),
  };
  const payment = { createCheckout: jest.fn(), resolveWebhook: jest.fn() };
  return { tenants, usage, svc: new BillingService(tenants as any, usage as any, payment as any) };
}

test('assertWithinQuota passes when under the plan quota', async () => {
  const { svc } = deps({ id: 'ten1', planId: 'free' }, 40); // free quota = 100
  await expect(svc.assertWithinQuota('ten1')).resolves.toBeUndefined();
});

test('assertWithinQuota throws 402 when the quota is reached', async () => {
  const { svc } = deps({ id: 'ten1', planId: 'free' }, 100);
  await expect(svc.assertWithinQuota('ten1')).rejects.toBeInstanceOf(HttpException);
  await svc.assertWithinQuota('ten1').catch((e: HttpException) => expect(e.getStatus()).toBe(402));
});

test('consumeQuota passes when under the plan quota', async () => {
  const { svc, usage } = deps({ id: 'ten1', planId: 'free' }, 40); // free quota = 100
  await expect(svc.consumeQuota('ten1')).resolves.toBeUndefined();
  expect(usage.incrementAndCheck).toHaveBeenCalledWith('ten1', 100);
});

test('consumeQuota throws 402 when the quota is reached', async () => {
  const { svc } = deps({ id: 'ten1', planId: 'free' }, 100);
  await expect(svc.consumeQuota('ten1')).rejects.toBeInstanceOf(HttpException);
  await svc.consumeQuota('ten1').catch((e: HttpException) => expect(e.getStatus()).toBe(402));
});

test('changePlan rejects an unknown plan and updates a valid one', async () => {
  const { svc, tenants } = deps({ id: 'ten1', planId: 'free' }, 0);
  await expect(svc.changePlan('ten1', 'enterprise')).rejects.toBeInstanceOf(HttpException);
  await svc.changePlan('ten1', 'pro');
  expect(tenants.update).toHaveBeenCalledWith({ id: 'ten1' }, { planId: 'pro' });
});

test('getCurrentInvoice shapes plan + usage', async () => {
  const { svc } = deps({ id: 'ten1', planId: 'pro' }, 1500);
  const inv = await svc.getCurrentInvoice('ten1');
  expect(inv).toMatchObject({ plan_id: 'pro', quota: 10000, used: 1500, remaining: 8500, within_quota: true });
  expect(inv.period).toMatch(/^\d{4}-\d{2}$/);
});

test('startCheckout delegates to the payment provider for a paid plan', async () => {
  const tenants = { findOneOrFail: jest.fn(), update: jest.fn() };
  const usage = { current: jest.fn(), incrementAndCheck: jest.fn() };
  const payment = { createCheckout: jest.fn(async () => ({ url: 'https://pay/x' })), resolveWebhook: jest.fn() };
  const svc = new BillingService(tenants as any, usage as any, payment as any);
  const r = await svc.startCheckout('ten1', 'pro');
  expect(r.url).toBe('https://pay/x');
  expect(payment.createCheckout).toHaveBeenCalledWith({ tenantId: 'ten1', planId: 'pro' });
});

test('startCheckout rejects an unknown or free plan', async () => {
  const payment = { createCheckout: jest.fn(), resolveWebhook: jest.fn() };
  const svc = new BillingService({} as any, {} as any, payment as any);
  await expect(svc.startCheckout('ten1', 'enterprise')).rejects.toBeInstanceOf(HttpException);
  await expect(svc.startCheckout('ten1', 'free')).rejects.toBeInstanceOf(HttpException);
  expect(payment.createCheckout).not.toHaveBeenCalled();
});

test('applySubscriptionChange updates plan + stripe ids', async () => {
  const tenants = { update: jest.fn(async () => ({ affected: 1 })) };
  const payment = { createCheckout: jest.fn(), resolveWebhook: jest.fn() };
  const svc = new BillingService(tenants as any, {} as any, payment as any);
  await svc.applySubscriptionChange({ tenantId: 'ten1', planId: 'pro', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
  expect(tenants.update).toHaveBeenCalledWith({ id: 'ten1' }, expect.objectContaining({ planId: 'pro', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }));
});

test('applySubscriptionChange ignores an unknown plan', async () => {
  const tenants = { update: jest.fn() };
  const svc = new BillingService(tenants as any, {} as any, { createCheckout: jest.fn(), resolveWebhook: jest.fn() } as any);
  await svc.applySubscriptionChange({ tenantId: 'ten1', planId: 'bogus' });
  expect(tenants.update).not.toHaveBeenCalled();
});
