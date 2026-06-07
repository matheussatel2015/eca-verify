import { BillingService } from './billing.service';
import { HttpException } from '@nestjs/common';

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
  return { tenants, usage, svc: new BillingService(tenants as any, usage as any) };
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
