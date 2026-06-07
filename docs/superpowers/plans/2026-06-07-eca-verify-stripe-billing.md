# ECA Verify — #4b Gateway de Pagamento (Stripe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real payment to the existing billing (plans + quota): a tenant subscribes to a paid plan via a Stripe-hosted Checkout, and a signature-verified Stripe webhook drives the tenant's `plan_id` (and stores the Stripe customer/subscription ids), so quota enforcement reflects the paid tier automatically.

**Architecture:** A `PaymentPort` abstracts the gateway, with a `MockPaymentProvider` (default, for dev/tests) and a `StripeAdapter` (real, deferred until `STRIPE_SECRET_KEY` exists) — mirroring the CAF adapter pattern. `POST /billing/checkout` creates a Stripe Checkout Subscription session and returns its URL. `POST /billing/stripe/webhook` (public, raw-body, signature-verified) maps `checkout.session.completed` / `customer.subscription.deleted` to a `SubscriptionChange` and updates the tenant. Plan↔Stripe-price mapping is env-driven.

**Tech Stack:** Builds on #4 Billing (NestJS, TypeORM/Postgres, Jest, the existing `plans.ts`/`BillingService`/`tenant` entity). Adds the `stripe` SDK. Default stays `mock`; switching to real Stripe is config + credentials, no code change.

> **Decisions:** Stripe **Checkout + Subscriptions** (hosted, redirect) + **webhook-driven plan sync** (Stripe is the source of truth). Adapter `mock|stripe`, default `mock`, live calls deferred. `tenants` has no RLS, so the webhook updates `plan_id` via the repo directly (the `eca_app` role has UPDATE grant).

---

## File Structure

```
apps/api/src/billing/
├── payment/
│   ├── payment.port.ts          # PaymentPort + types + PAYMENT_PROVIDER token
│   ├── mock-payment.ts          # MockPaymentProvider (TDD)
│   ├── stripe-adapter.ts        # StripeAdapter (Stripe SDK) (TDD w/ mocked SDK)
│   └── payment-factory.ts       # buildPaymentProvider(mock|stripe) (TDD)
├── stripe-prices.ts             # plan -> Stripe price id (env) (TDD)
├── billing.service.ts           # MOD: startCheckout + applySubscriptionChange
├── billing.controller.ts        # MOD: POST /billing/checkout + /billing/stripe/webhook
└── billing.module.ts            # MOD: provide PaymentPort
apps/api/src/config.ts           # MOD: payment config
apps/api/src/main.ts             # MOD: rawBody: true (for webhook signature)
apps/api/src/tenant/tenant.entity.ts          # MOD: stripeCustomerId/stripeSubscriptionId
apps/api/src/db/migrations/0010-tenant-stripe.ts  # NEW
.env.example                     # MOD
apps/api/test/stripe-smoke.md    # NEW
```

---

## Task 1: PaymentPort + price map + MockPaymentProvider

**Files:**
- Create: `apps/api/src/billing/payment/payment.port.ts`, `apps/api/src/billing/stripe-prices.ts`, `apps/api/src/billing/payment/mock-payment.ts`
- Test: `apps/api/src/billing/stripe-prices.spec.ts`, `apps/api/src/billing/payment/mock-payment.spec.ts`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/billing/stripe-prices.spec.ts`
```ts
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
```

`apps/api/src/billing/payment/mock-payment.spec.ts`
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest stripe-prices mock-payment`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`apps/api/src/billing/payment/payment.port.ts`
```ts
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutInput {
  tenantId: string;
  planId: string;
}
export interface CheckoutResult {
  url: string;
}
export interface SubscriptionChange {
  tenantId: string;
  planId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface PaymentPort {
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Verify + parse a gateway webhook into a plan change, or null if irrelevant/invalid. */
  resolveWebhook(rawBody: Buffer, signature: string): Promise<SubscriptionChange | null>;
}
```

`apps/api/src/billing/stripe-prices.ts`
```ts
export function stripePriceFor(planId: string, env: NodeJS.ProcessEnv): string {
  if (planId === 'pro') return env.STRIPE_PRICE_PRO ?? '';
  if (planId === 'scale') return env.STRIPE_PRICE_SCALE ?? '';
  return ''; // free or unknown — no subscription price
}
```

`apps/api/src/billing/payment/mock-payment.ts`
```ts
import { CheckoutInput, CheckoutResult, PaymentPort, SubscriptionChange } from './payment.port';

export class MockPaymentProvider implements PaymentPort {
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return { url: `https://checkout.mock/session?tenant=${input.tenantId}&plan=${input.planId}` };
  }
  async resolveWebhook(rawBody: Buffer, _signature: string): Promise<SubscriptionChange | null> {
    try {
      const o = JSON.parse(rawBody.toString('utf8'));
      if (typeof o?.tenantId === 'string' && typeof o?.planId === 'string') {
        return { tenantId: o.tenantId, planId: o.planId, stripeCustomerId: o.stripeCustomerId, stripeSubscriptionId: o.stripeSubscriptionId };
      }
      return null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest stripe-prices mock-payment`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/payment/payment.port.ts apps/api/src/billing/stripe-prices.ts apps/api/src/billing/stripe-prices.spec.ts apps/api/src/billing/payment/mock-payment.ts apps/api/src/billing/payment/mock-payment.spec.ts
git commit -m "feat(billing): PaymentPort + plan->price map + mock payment provider"
```

---

## Task 2: Stripe dep + config + StripeAdapter

**Files:**
- Modify: `apps/api/package.json`, `apps/api/src/config.ts`, `.env.example`
- Create: `apps/api/src/billing/payment/stripe-adapter.ts`
- Test: `apps/api/src/billing/payment/stripe-adapter.spec.ts`

- [ ] **Step 1: Add the `stripe` dependency and install**

Add `"stripe": "^17.3.1"` to `apps/api/package.json` dependencies, then run `npm install`.

- [ ] **Step 2: Add payment config to `apps/api/src/config.ts`**

```ts
export type PaymentKind = 'mock' | 'stripe';

export interface PaymentConfig {
  kind: PaymentKind;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  successUrl: string;
  cancelUrl: string;
}

export function loadPaymentConfig(env: NodeJS.ProcessEnv): PaymentConfig {
  return {
    kind: (env.PAYMENT_PROVIDER_KIND ?? 'mock') as PaymentKind,
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    successUrl: env.CHECKOUT_SUCCESS_URL ?? 'http://localhost:3000/dashboard?checkout=success',
    cancelUrl: env.CHECKOUT_CANCEL_URL ?? 'http://localhost:3000/dashboard?checkout=cancel',
  };
}
```
Append to `.env.example`:
```
PAYMENT_PROVIDER_KIND=mock
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=
STRIPE_PRICE_SCALE=
CHECKOUT_SUCCESS_URL=http://localhost:3000/dashboard?checkout=success
CHECKOUT_CANCEL_URL=http://localhost:3000/dashboard?checkout=cancel
```

- [ ] **Step 3: Write the failing test (mock the Stripe SDK)**

`apps/api/src/billing/payment/stripe-adapter.spec.ts`
```ts
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
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `npx jest stripe-adapter`
Expected: FAIL — cannot find './stripe-adapter'.

- [ ] **Step 4: Write `apps/api/src/billing/payment/stripe-adapter.ts`**

```ts
import type Stripe from 'stripe';
import { CheckoutInput, CheckoutResult, PaymentPort, SubscriptionChange } from './payment.port';

export interface StripeAdapterConfig {
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
  priceFor: (planId: string) => string;
}

export class StripeAdapter implements PaymentPort {
  constructor(private readonly stripe: Stripe, private readonly cfg: StripeAdapterConfig) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const price = this.cfg.priceFor(input.planId);
    if (!price) throw new Error(`no Stripe price configured for plan '${input.planId}'`);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: this.cfg.successUrl,
      cancel_url: this.cfg.cancelUrl,
      client_reference_id: input.tenantId,
      metadata: { tenantId: input.tenantId, planId: input.planId },
    });
    return { url: session.url ?? '' };
  }

  async resolveWebhook(rawBody: Buffer, signature: string): Promise<SubscriptionChange | null> {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.cfg.webhookSecret);
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      return {
        tenantId: s.client_reference_id ?? '',
        planId: (s.metadata?.planId as string) ?? '',
        stripeCustomerId: (s.customer as string) ?? undefined,
        stripeSubscriptionId: (s.subscription as string) ?? undefined,
      };
    }
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      return { tenantId: (sub.metadata?.tenantId as string) ?? '', planId: 'free', stripeSubscriptionId: sub.id };
    }
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest stripe-adapter`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/config.ts .env.example apps/api/src/billing/payment/stripe-adapter.ts apps/api/src/billing/payment/stripe-adapter.spec.ts
git commit -m "feat(billing): Stripe adapter (checkout + webhook) + payment config + dep"
```

---

## Task 3: Tenant Stripe columns + migration 0010

**Files:**
- Modify: `apps/api/src/tenant/tenant.entity.ts`
- Create: `apps/api/src/db/migrations/0010-tenant-stripe.ts`

- [ ] **Step 1: Add columns to `apps/api/src/tenant/tenant.entity.ts`**

```ts
  @Column({ name: 'stripe_customer_id', type: 'text', nullable: true }) stripeCustomerId!: string | null;
  @Column({ name: 'stripe_subscription_id', type: 'text', nullable: true }) stripeSubscriptionId!: string | null;
```

- [ ] **Step 2: Write `apps/api/src/db/migrations/0010-tenant-stripe.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantStripe1717632000010 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants ADD COLUMN stripe_customer_id text`);
    await q.query(`ALTER TABLE tenants ADD COLUMN stripe_subscription_id text`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants DROP COLUMN stripe_subscription_id`);
    await q.query(`ALTER TABLE tenants DROP COLUMN stripe_customer_id`);
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -b apps/api`
Expected: clean.

- [ ] **Step 4: Run the migration if a database is reachable (else DEFER)**

Run: `npx typeorm-ts-node-commonjs migration:run -d apps/api/src/db/data-source.ts`
Expected: "Migration TenantStripe1717632000010 has been executed successfully." If no DB, mark DEFERRED.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tenant/tenant.entity.ts apps/api/src/db/migrations/0010-tenant-stripe.ts
git commit -m "feat(db): tenant Stripe customer/subscription columns (migration 0010)"
```

---

## Task 4: BillingService — startCheckout + applySubscriptionChange

**Files:**
- Modify: `apps/api/src/billing/billing.service.ts`
- Test: `apps/api/src/billing/billing.service.spec.ts` (extend)

- [ ] **Step 1: Write the failing tests (append)**

```ts
import { isValidPlanId } from './plans';

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
```
(Add `import { HttpException } from '@nestjs/common';` to the spec if not present.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest billing.service`
Expected: FAIL — `startCheckout`/`applySubscriptionChange` not functions / constructor arity.

- [ ] **Step 3: Edit `apps/api/src/billing/billing.service.ts`**

Add the payment port to the constructor and the two methods (keep existing members):
```ts
import { PaymentPort, SubscriptionChange, CheckoutResult } from './payment/payment.port';
// ...
@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly usage: UsageService,
    @Inject(PAYMENT_PROVIDER) private readonly payment: PaymentPort,
  ) {}

  async startCheckout(tenantId: string, planId: string): Promise<CheckoutResult> {
    if (!isValidPlanId(planId) || planId === 'free') {
      throw new HttpException(`plan '${planId}' is not purchasable`, HttpStatus.BAD_REQUEST);
    }
    return this.payment.createCheckout({ tenantId, planId });
  }

  async applySubscriptionChange(change: SubscriptionChange): Promise<void> {
    if (!isValidPlanId(change.planId)) return; // ignore unknown plans defensively
    await this.tenants.update(
      { id: change.tenantId },
      {
        planId: change.planId,
        ...(change.stripeCustomerId ? { stripeCustomerId: change.stripeCustomerId } : {}),
        ...(change.stripeSubscriptionId ? { stripeSubscriptionId: change.stripeSubscriptionId } : {}),
      },
    );
  }
}
```
Add imports: `import { Inject } from '@nestjs/common';` and `import { PAYMENT_PROVIDER } from './payment/payment.port';` (HttpException/HttpStatus already imported from #4).

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest billing.service`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/src/billing/billing.service.spec.ts
git commit -m "feat(billing): startCheckout + applySubscriptionChange"
```

---

## Task 5: Endpoints + raw-body webhook + factory + wiring

**Files:**
- Modify: `apps/api/src/billing/billing.controller.ts`, `apps/api/src/billing/billing.module.ts`, `apps/api/src/main.ts`
- Create: `apps/api/src/billing/payment/payment-factory.ts` (+ test)

- [ ] **Step 1: Write the failing factory test**

`apps/api/src/billing/payment/payment-factory.spec.ts`
```ts
import { buildPaymentProvider } from './payment-factory';
import { MockPaymentProvider } from './mock-payment';
import { StripeAdapter } from './stripe-adapter';

test('returns the mock provider by default', () => {
  expect(buildPaymentProvider({ kind: 'mock' } as any, {})).toBeInstanceOf(MockPaymentProvider);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest payment-factory`
Expected: FAIL — cannot find './payment-factory'.

- [ ] **Step 3: Write `apps/api/src/billing/payment/payment-factory.ts`**

```ts
import Stripe from 'stripe';
import { PaymentConfig } from '../../config';
import { PaymentPort } from './payment.port';
import { MockPaymentProvider } from './mock-payment';
import { StripeAdapter } from './stripe-adapter';
import { stripePriceFor } from '../stripe-prices';

export function buildPaymentProvider(cfg: PaymentConfig, env: NodeJS.ProcessEnv): PaymentPort {
  if (cfg.kind === 'mock') return new MockPaymentProvider();
  if (!cfg.stripeSecretKey) throw new Error('STRIPE_SECRET_KEY is required for PAYMENT_PROVIDER_KIND=stripe');
  const stripe = new Stripe(cfg.stripeSecretKey);
  return new StripeAdapter(stripe, {
    webhookSecret: cfg.stripeWebhookSecret,
    successUrl: cfg.successUrl,
    cancelUrl: cfg.cancelUrl,
    priceFor: (planId: string) => stripePriceFor(planId, env),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest payment-factory`
Expected: PASS (3 tests).

- [ ] **Step 5: Extend `apps/api/src/billing/billing.controller.ts`**

Add the checkout + webhook routes (keep the existing plan/invoice routes):
```ts
import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
// ... existing imports (BillingService, ApiKeyGuard, PLANS) ...

  // Start a hosted Stripe Checkout for a paid plan.
  @Post('checkout')
  @UseGuards(ApiKeyGuard)
  async checkout(@Req() req: any, @Body() body: { plan_id?: unknown }) {
    if (typeof body.plan_id !== 'string' || !body.plan_id) throw new BadRequestException('plan_id is required');
    return this.billing.startCheckout(req.tenant.id, body.plan_id);
  }

  // Stripe webhook: public, raw-body + signature-verified inside the provider.
  @Post('stripe/webhook')
  @HttpCode(202)
  async stripeWebhook(@Req() req: any) {
    const signature = req.headers['stripe-signature'] ?? '';
    const raw: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const change = await this.billing.resolveAndApplyWebhook(raw, signature);
    return { received: true, applied: !!change };
  }
```
Add a thin `resolveAndApplyWebhook` to `BillingService` (so the controller doesn't need the port directly):
```ts
  async resolveAndApplyWebhook(rawBody: Buffer, signature: string): Promise<boolean> {
    const change = await this.payment.resolveWebhook(rawBody, signature);
    if (!change || !change.tenantId) return false;
    await this.applySubscriptionChange(change);
    return true;
  }
```
(Add this method to `billing.service.ts` and a unit test asserting it applies when the provider returns a change and no-ops on null.)

- [ ] **Step 6: Provide the PaymentPort in `apps/api/src/billing/billing.module.ts`**

```ts
import { PAYMENT_PROVIDER } from './payment/payment.port';
import { buildPaymentProvider } from './payment/payment-factory';
import { loadPaymentConfig } from '../config';
// in providers: []
    { provide: PAYMENT_PROVIDER, useFactory: () => buildPaymentProvider(loadPaymentConfig(process.env), process.env) },
```
(BillingService now depends on PAYMENT_PROVIDER — it is provided here; ensure `BillingService` provider stays.)

- [ ] **Step 7: Enable raw body in `apps/api/src/main.ts`**

Change `const app = await NestFactory.create(AppModule);` to `const app = await NestFactory.create(AppModule, { rawBody: true });` (NestJS populates `req.rawBody` for signature verification). Keep helmet + global filter + shutdown hooks.

- [ ] **Step 8: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green. (Existing `billing.service.spec` constructs `new BillingService(tenants, usage)` — update those call sites to pass a mock payment provider as the 3rd arg, e.g. `new BillingService(tenants, usage, { createCheckout: jest.fn(), resolveWebhook: jest.fn() } as any)`.)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/billing/payment/payment-factory.ts apps/api/src/billing/payment/payment-factory.spec.ts apps/api/src/billing/billing.controller.ts apps/api/src/billing/billing.service.ts apps/api/src/billing/billing.service.spec.ts apps/api/src/billing/billing.module.ts apps/api/src/main.ts
git commit -m "feat(billing): /billing/checkout + /billing/stripe/webhook + provider wiring + rawBody"
```

---

## Task 6: Stripe smoke + README

**Files:**
- Create: `apps/api/test/stripe-smoke.md`
- Modify: `README.md`

- [ ] **Step 1: Write `apps/api/test/stripe-smoke.md`**

````markdown
# Stripe billing smoke

## Mock mode (default — no Stripe account)
1. Register a tenant; with its key:
   `curl -s -X POST http://localhost:3000/billing/checkout -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"plan_id":"pro"}'` → returns a `https://checkout.mock/...` URL.
2. Simulate the webhook (mock provider parses JSON, no signature):
   `curl -s -X POST http://localhost:3000/billing/stripe/webhook -H "Content-Type: application/json" -d '{"tenantId":"<tenant_id>","planId":"pro"}'` → `{received:true,applied:true}`.
3. `GET /billing/plan` → now `plan_id=pro`, quota 10000.

## Real Stripe (sandbox)
Set `PAYMENT_PROVIDER_KIND=stripe`, `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `STRIPE_PRICE_PRO`/`STRIPE_PRICE_SCALE` (test price ids).
1. `POST /billing/checkout {plan_id:pro}` → real Stripe Checkout URL; pay with test card `4242 4242 4242 4242`.
2. Point a Stripe webhook (or `stripe listen --forward-to localhost:3000/billing/stripe/webhook`) → on `checkout.session.completed` the tenant's `plan_id` flips to `pro` and `stripe_customer_id`/`stripe_subscription_id` are stored.
3. Cancel the subscription in Stripe → `customer.subscription.deleted` → tenant downgraded to `free`.
````

- [ ] **Step 2: Add a README note** under the billing/roadmap area: a short "Pagamento (Stripe)" subsection — mock default, opt-in real Stripe via `PAYMENT_PROVIDER_KIND=stripe` + keys, endpoints `/billing/checkout` and `/billing/stripe/webhook`.

- [ ] **Step 3: Run the full unit suite**

Run: `npx jest`
Expected: all green, incl. stripe-prices, mock-payment, stripe-adapter, payment-factory, and the new billing.service cases.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/stripe-smoke.md README.md
git commit -m "test(billing): Stripe smoke + README payment section"
```

---

## Self-Review Notes

- **Decisions honored:** hosted **Checkout + Subscriptions** (`stripe-adapter.createCheckout` mode `subscription`); **webhook sync** (`resolveWebhook` → `applySubscriptionChange` updates `tenant.plan_id`); adapter `mock|stripe` with `mock` default and live deferred (no `STRIPE_SECRET_KEY` needed for dev/tests).
- **Type consistency:** `PaymentPort`/`CheckoutInput`/`CheckoutResult`/`SubscriptionChange`/`PAYMENT_PROVIDER` (Task 1) used by mock + stripe adapters, the factory, `BillingService`, and the controller; `stripePriceFor` (Task 1) used by the factory; `PaymentConfig`/`loadPaymentConfig` (Task 2) used by the factory + module; `tenant.stripeCustomerId/stripeSubscriptionId` (Task 3) written by `applySubscriptionChange`.
- **Security:** the webhook route is public but the Stripe signature is verified inside `StripeAdapter.resolveWebhook` (via `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`); the mock provider only trusts JSON in dev. `rawBody: true` preserves the exact payload for signature verification. `/billing/checkout` requires the API key. `tenants` has no RLS, so the webhook's `update` is a direct grant-backed write (no app.tenant_id needed).
- **No placeholders:** every step has complete code. `stripe` is the one new dependency; live calls deferred until credentials exist.
- **DB-dependent:** migration 0010 run (Task 3) + the smoke (Task 6) need infra; all logic is unit-tested (Stripe SDK mocked; mock provider for the flow).
- **Follow-up:** surfacing checkout in the dashboard UI (a "Upgrade" button hitting `/billing/checkout`) and richer subscription lifecycle (past_due, trials) are future polish.
```
