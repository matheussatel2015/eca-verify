# ECA Verify — #4 Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add subscription plans with a monthly usage quota that is metered in Redis and enforced (HTTP 402 when exceeded), plus a billing endpoint that reports the current plan, usage, and a computed invoice — no external payment gateway.

**Architecture:** A static `PLANS` catalog (free/pro/scale) defines each tier's monthly quota and price. Each tenant carries a `plan_id` (default `free`). A `UsageService` increments a per-tenant, per-month counter in Redis (`usage:{tenantId}:{YYYY-MM}`) and reads it cheaply for quota checks. `BillingService` enforces the quota (`assertWithinQuota` → 402), changes plans, and builds an invoice. Enforcement + metering happen at **session creation** (`POST /sessions`), where the tenant is already authenticated by `ApiKeyGuard` — counting verification starts as the billable unit. A `BillingController` exposes plan catalog, current plan/usage, plan change, and invoice.

**Tech Stack:** Builds on the merged codebase (NestJS, TypeORM/Postgres, Redis via the existing `RedisLike`/`IoRedisAdapter`, Jest). Reuses `ApiKeyGuard`, the `Tenant` entity, and the Redis seam. No payment gateway (future #4b: a `PaymentPort` + Stripe adapter, mirroring CAF).

> **Billing model:** plans with a hard monthly quota; over quota → `402 Payment Required` (no overage charges). **Metering:** Redis counter per tenant/month. **Invoice:** computed (flat plan price + usage summary), not charged.
> **Enforcement point:** `POST /sessions` (authenticated; clean access to the tenant). Counts verification starts.

---

## File Structure

```
apps/api/src/billing/
├── plans.ts              # PLANS catalog + getPlan/isValidPlanId (pure, TDD)
├── invoice.ts            # buildInvoice (pure, TDD)
├── usage.service.ts      # monthKey + Redis-backed UsageService (TDD)
├── billing.service.ts    # assertWithinQuota / changePlan / getCurrentInvoice (TDD)
├── billing.controller.ts # GET /billing/plans|plan, PUT /billing/plan, GET /billing/invoice
└── billing.module.ts
apps/api/src/redis/redis-like.ts        # MODIFIED: add get()
apps/api/src/redis/ioredis.adapter.ts   # MODIFIED: add get()
apps/api/src/tenant/tenant.entity.ts    # MODIFIED: add planId
apps/api/src/db/migrations/0004-tenant-plan.ts   # NEW
apps/api/src/session/session.controller.ts       # MODIFIED: enforce quota + meter usage
apps/api/src/session/session.module.ts           # MODIFIED: import BillingModule
apps/api/src/app.module.ts                        # MODIFIED: import BillingModule
apps/api/test/billing-smoke.md                    # NEW
```

---

## Task 1: Plans catalog + invoice builder (pure)

**Files:**
- Create: `apps/api/src/billing/plans.ts`, `apps/api/src/billing/invoice.ts`
- Test: `apps/api/src/billing/plans.spec.ts`, `apps/api/src/billing/invoice.spec.ts`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/billing/plans.spec.ts`
```ts
import { getPlan, isValidPlanId, PLANS, DEFAULT_PLAN_ID } from './plans';

test('has free, pro and scale tiers', () => {
  expect(Object.keys(PLANS).sort()).toEqual(['free', 'pro', 'scale']);
});

test('getPlan returns the tier or falls back to the default', () => {
  expect(getPlan('pro').id).toBe('pro');
  expect(getPlan('nope').id).toBe(DEFAULT_PLAN_ID);
  expect(getPlan(null).id).toBe(DEFAULT_PLAN_ID);
});

test('isValidPlanId only accepts known plans', () => {
  expect(isValidPlanId('scale')).toBe(true);
  expect(isValidPlanId('enterprise')).toBe(false);
});
```

`apps/api/src/billing/invoice.spec.ts`
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest billing/plans billing/invoice`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`apps/api/src/billing/plans.ts`
```ts
export interface Plan {
  id: string;
  name: string;
  monthlyQuota: number;
  monthlyPriceCents: number;
}

export const PLANS: Record<string, Plan> = {
  free: { id: 'free', name: 'Free', monthlyQuota: 100, monthlyPriceCents: 0 },
  pro: { id: 'pro', name: 'Pro', monthlyQuota: 10000, monthlyPriceCents: 49900 },
  scale: { id: 'scale', name: 'Scale', monthlyQuota: 100000, monthlyPriceCents: 199900 },
};

export const DEFAULT_PLAN_ID = 'free';

export function getPlan(id: string | null | undefined): Plan {
  return PLANS[id ?? ''] ?? PLANS[DEFAULT_PLAN_ID];
}

export function isValidPlanId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLANS, id);
}
```

`apps/api/src/billing/invoice.ts`
```ts
import { Plan } from './plans';

export interface Invoice {
  period: string;
  plan_id: string;
  plan_name: string;
  monthly_price_cents: number;
  quota: number;
  used: number;
  remaining: number;
  within_quota: boolean;
}

export function buildInvoice(plan: Plan, used: number, period: string): Invoice {
  return {
    period,
    plan_id: plan.id,
    plan_name: plan.name,
    monthly_price_cents: plan.monthlyPriceCents,
    quota: plan.monthlyQuota,
    used,
    remaining: Math.max(0, plan.monthlyQuota - used),
    within_quota: used <= plan.monthlyQuota,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest billing/plans billing/invoice`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/plans.ts apps/api/src/billing/plans.spec.ts apps/api/src/billing/invoice.ts apps/api/src/billing/invoice.spec.ts
git commit -m "feat(billing): plans catalog + invoice builder"
```

---

## Task 2: Redis get() + UsageService

**Files:**
- Modify: `apps/api/src/redis/redis-like.ts`, `apps/api/src/redis/ioredis.adapter.ts`, `apps/api/src/ratelimit/rate-limiter.spec.ts`, `apps/api/src/queue/once-guard.spec.ts`
- Create: `apps/api/src/billing/usage.service.ts`
- Test: `apps/api/src/billing/usage.service.spec.ts`

- [ ] **Step 1: Add `get` to the Redis seam**

In `apps/api/src/redis/redis-like.ts`, add to the `RedisLike` interface:
```ts
  get(key: string): Promise<string | null>;
```
In `apps/api/src/redis/ioredis.adapter.ts`, add the method to `IoRedisAdapter`:
```ts
  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }
```

- [ ] **Step 2: Keep existing fakes compiling**

The `RedisLike` interface now requires `get`. Add a stub to the two existing in-test fakes so they still satisfy the interface:
- In `apps/api/src/ratelimit/rate-limiter.spec.ts`, inside `class FakeRedis implements RedisLike`, add: `async get() { return null; }`
- In `apps/api/src/queue/once-guard.spec.ts`, inside `class FakeRedis implements RedisLike`, add: `async get() { return null; }`

- [ ] **Step 3: Write the failing test**

`apps/api/src/billing/usage.service.spec.ts`
```ts
import { UsageService, monthKey } from './usage.service';
import { RedisLike } from '../redis/redis-like';

class FakeRedis implements RedisLike {
  store = new Map<string, number>();
  expired = new Map<string, number>();
  async incr(key: string) { const n = (this.store.get(key) ?? 0) + 1; this.store.set(key, n); return n; }
  async pexpire(key: string, ms: number) { this.expired.set(key, ms); }
  async pttl() { return -1; }
  async setNx() { return true; }
  async get(key: string) { const v = this.store.get(key); return v === undefined ? null : String(v); }
}

const FIXED = new Date('2026-06-15T00:00:00Z');

test('monthKey is per tenant per UTC month', () => {
  expect(monthKey('ten1', FIXED)).toBe('usage:ten1:2026-06');
});

test('increment counts up and sets a TTL only on the first hit', async () => {
  const redis = new FakeRedis();
  const usage = new UsageService(redis, () => FIXED);
  expect(await usage.increment('ten1')).toBe(1);
  expect(await usage.increment('ten1')).toBe(2);
  expect(redis.expired.size).toBe(1); // TTL set once
});

test('current reads the counter, defaulting to 0', async () => {
  const redis = new FakeRedis();
  const usage = new UsageService(redis, () => FIXED);
  expect(await usage.current('ten1')).toBe(0);
  await usage.increment('ten1');
  expect(await usage.current('ten1')).toBe(1);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest usage.service`
Expected: FAIL — cannot find './usage.service'.

- [ ] **Step 5: Write `apps/api/src/billing/usage.service.ts`**

```ts
import { RedisLike } from '../redis/redis-like';

const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

export function monthKey(tenantId: string, now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `usage:${tenantId}:${y}-${m}`;
}

export class UsageService {
  constructor(private readonly redis: RedisLike, private readonly nowFn: () => Date = () => new Date()) {}

  async increment(tenantId: string): Promise<number> {
    const key = monthKey(tenantId, this.nowFn());
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.pexpire(key, FORTY_DAYS_MS); // expire after the month closes
    return n;
  }

  async current(tenantId: string): Promise<number> {
    const v = await this.redis.get(monthKey(tenantId, this.nowFn()));
    return v ? Number(v) : 0;
  }
}
```

- [ ] **Step 6: Run test + full suite to verify it passes (and fakes still compile)**

Run: `npx jest usage.service rate-limiter once-guard`
Expected: PASS (usage 3 + existing rate-limiter/once-guard tests still green).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/redis/redis-like.ts apps/api/src/redis/ioredis.adapter.ts apps/api/src/ratelimit/rate-limiter.spec.ts apps/api/src/queue/once-guard.spec.ts apps/api/src/billing/usage.service.ts apps/api/src/billing/usage.service.spec.ts
git commit -m "feat(billing): Redis get() + per-tenant monthly usage meter"
```

---

## Task 3: Tenant plan column + migration 0004

**Files:**
- Modify: `apps/api/src/tenant/tenant.entity.ts`
- Create: `apps/api/src/db/migrations/0004-tenant-plan.ts`

- [ ] **Step 1: Add `planId` to the Tenant entity**

In `apps/api/src/tenant/tenant.entity.ts`, add a column (keep the existing columns):
```ts
  @Column({ name: 'plan_id', default: 'free' }) planId!: string;
```

- [ ] **Step 2: Write `apps/api/src/db/migrations/0004-tenant-plan.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantPlan1717632000004 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants ADD COLUMN plan_id text NOT NULL DEFAULT 'free'`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants DROP COLUMN plan_id`);
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc -b apps/api`
Expected: clean.

- [ ] **Step 4: Run the migration if a database is reachable (else DEFER)**

Run: `npx typeorm-ts-node-commonjs migration:run -d apps/api/src/db/data-source.ts`
Expected: "Migration TenantPlan1717632000004 has been executed successfully." If no DB reachable, mark DEFERRED; do not fabricate output.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tenant/tenant.entity.ts apps/api/src/db/migrations/0004-tenant-plan.ts
git commit -m "feat(db): tenant plan_id column (migration 0004)"
```

---

## Task 4: BillingService

**Files:**
- Create: `apps/api/src/billing/billing.service.ts`
- Test: `apps/api/src/billing/billing.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/billing/billing.service.spec.ts`
```ts
import { BillingService } from './billing.service';
import { HttpException } from '@nestjs/common';

function deps(tenant: any, used: number) {
  const tenants = { findOneOrFail: jest.fn(async () => tenant), update: jest.fn(async () => ({ affected: 1 })) };
  const usage = { current: jest.fn(async () => used), increment: jest.fn() };
  return { tenants, usage, svc: new BillingService(tenants as any, usage as any) };
}

test('assertWithinQuota passes when under the plan quota', async () => {
  const { svc } = deps({ id: 'ten1', planId: 'free' }, 40); // free quota = 100
  await expect(svc.assertWithinQuota('ten1')).resolves.toBeUndefined();
});

test('assertWithinQuota throws 402 when the quota is reached', async () => {
  const { svc } = deps({ id: 'ten1', planId: 'free' }, 100);
  await expect(svc.assertWithinQuota('ten1')).rejects.toBeInstanceOf(HttpException);
  await svc.assertWithinQuota('ten1').catch((e) => expect(e.getStatus()).toBe(402));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest billing.service`
Expected: FAIL — cannot find './billing.service'.

- [ ] **Step 3: Write `apps/api/src/billing/billing.service.ts`**

```ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenant/tenant.entity';
import { UsageService } from './usage.service';
import { getPlan, isValidPlanId } from './plans';
import { buildInvoice, Invoice } from './invoice';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly usage: UsageService,
  ) {}

  async assertWithinQuota(tenantId: string): Promise<void> {
    const tenant = await this.tenants.findOneOrFail({ where: { id: tenantId } });
    const plan = getPlan(tenant.planId);
    const used = await this.usage.current(tenantId);
    if (used >= plan.monthlyQuota) {
      throw new HttpException(
        `monthly quota of ${plan.monthlyQuota} reached for plan '${plan.id}'`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async changePlan(tenantId: string, planId: string): Promise<void> {
    if (!isValidPlanId(planId)) {
      throw new HttpException(`unknown plan '${planId}'`, HttpStatus.BAD_REQUEST);
    }
    await this.tenants.update({ id: tenantId }, { planId });
  }

  async getCurrentInvoice(tenantId: string): Promise<Invoice> {
    const tenant = await this.tenants.findOneOrFail({ where: { id: tenantId } });
    const used = await this.usage.current(tenantId);
    return buildInvoice(getPlan(tenant.planId), used, this.currentPeriod());
  }

  private currentPeriod(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest billing.service`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/billing.service.ts apps/api/src/billing/billing.service.spec.ts
git commit -m "feat(billing): quota enforcement + plan change + invoice service"
```

---

## Task 5: Billing controller + module

**Files:**
- Create: `apps/api/src/billing/billing.controller.ts`, `apps/api/src/billing/billing.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/billing/billing.controller.ts`**

```ts
import { BadRequestException, Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { BillingService } from './billing.service';
import { PLANS } from './plans';

interface ChangePlanBody { plan_id?: unknown }

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Public catalog of available plans.
  @Get('plans')
  plans() {
    return Object.values(PLANS);
  }

  @Get('plan')
  @UseGuards(ApiKeyGuard)
  async current(@Req() req: any) {
    return this.billing.getCurrentInvoice(req.tenant.id);
  }

  @Put('plan')
  @UseGuards(ApiKeyGuard)
  async change(@Req() req: any, @Body() body: ChangePlanBody) {
    if (typeof body.plan_id !== 'string' || !body.plan_id) {
      throw new BadRequestException('plan_id is required');
    }
    await this.billing.changePlan(req.tenant.id, body.plan_id);
    return this.billing.getCurrentInvoice(req.tenant.id);
  }

  @Get('invoice')
  @UseGuards(ApiKeyGuard)
  async invoice(@Req() req: any) {
    return this.billing.getCurrentInvoice(req.tenant.id);
  }
}
```

- [ ] **Step 2: Write `apps/api/src/billing/billing.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Tenant } from '../tenant/tenant.entity';
import { TenantModule } from '../tenant/tenant.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { UsageService } from './usage.service';
import { IoRedisAdapter } from '../redis/ioredis.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), TenantModule],
  controllers: [BillingController],
  providers: [
    {
      provide: UsageService,
      useFactory: () =>
        new UsageService(new IoRedisAdapter(new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'))),
    },
    BillingService,
  ],
  exports: [BillingService, UsageService],
})
export class BillingModule {}
```

- [ ] **Step 3: Register in `apps/api/src/app.module.ts`**

Add `import { BillingModule } from './billing/billing.module';` and add `BillingModule` to the `imports` array of `@Module`.

- [ ] **Step 4: Verify build + full suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/billing/billing.controller.ts apps/api/src/billing/billing.module.ts apps/api/src/app.module.ts
git commit -m "feat(billing): controller + module (plans, plan change, invoice)"
```

---

## Task 6: Enforce quota + meter usage at session creation

**Files:**
- Modify: `apps/api/src/session/session.controller.ts`, `apps/api/src/session/session.module.ts`

- [ ] **Step 1: Inject billing into `SessionController`**

In `apps/api/src/session/session.controller.ts`, add imports:
```ts
import { BillingService } from '../billing/billing.service';
import { UsageService } from '../billing/usage.service';
```
Add the two services to the constructor (keep the existing `@InjectRepository(VerificationSession)` param):
```ts
  constructor(
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
    private readonly billing: BillingService,
    private readonly usage: UsageService,
  ) {}
```

- [ ] **Step 2: Enforce + meter in `create(...)`**

At the start of `create(...)` — right after the existing PII / `user_hash` validation and before building the session — add the quota check; after the session is saved, increment usage:
```ts
    const tenantId = req.tenant.id as string;
    await this.billing.assertWithinQuota(tenantId); // throws 402 when over the monthly quota
```
(Use this `tenantId` for the rest of the method; the existing code already reads `req.tenant.id` — keep it consistent.)
After the `await this.sessions.manager.transaction(...)` block that saves the session, add:
```ts
    await this.usage.increment(tenantId);
```

- [ ] **Step 3: Import BillingModule in `apps/api/src/session/session.module.ts`**

Add `import { BillingModule } from '../billing/billing.module';` and add `BillingModule` to the module's `imports` array (alongside `TenantModule` and the `TypeOrmModule.forFeature([...])`).

- [ ] **Step 4: Verify build + full suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green (the existing `pii-guard` test is unaffected; the session controller has no unit spec, so this is verified by compilation + the billing.service tests covering `assertWithinQuota`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/session/session.controller.ts apps/api/src/session/session.module.ts
git commit -m "feat(billing): enforce monthly quota + meter usage on session creation"
```

---

## Task 7: Billing smoke (manual)

**Files:**
- Create: `apps/api/test/billing-smoke.md`

- [ ] **Step 1: Write `apps/api/test/billing-smoke.md`**

````markdown
# Billing smoke (requires infra + API running + a seeded tenant)

1. Run migrations 0001–0004, start the API + Redis.
2. Plan catalog: `curl -s http://localhost:3000/billing/plans` → lists free/pro/scale.
3. Current plan/usage: `curl -s http://localhost:3000/billing/plan -H "Authorization: Bearer <key>"` → plan_id `free`, used `0`, quota `100`.
4. Consume quota: create sessions (`POST /sessions`) and watch `used` climb on `/billing/plan`.
5. Quota block: lower the `free` quota temporarily (or loop sessions past 100) → `POST /sessions` returns **402** once `used >= quota`.
6. Upgrade: `curl -s -X PUT http://localhost:3000/billing/plan -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"plan_id":"pro"}'` → now quota is 10000 and sessions succeed again.
7. Invoice: `curl -s http://localhost:3000/billing/invoice -H "Authorization: Bearer <key>"` → period (YYYY-MM), plan, monthly_price_cents, quota, used, remaining.
8. Tenant isolation: tenant A's usage counter is independent of tenant B's (different Redis keys).
````

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest`
Expected: all suites green, including the new billing suites (plans, invoice, usage.service, billing.service).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/billing-smoke.md
git commit -m "test(billing): billing smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage (PRD §3 Épico 1 "faturamento" + "limites de uso"):** plans → `PLANS` catalog + `GET /billing/plans` + `PUT /billing/plan` (Tasks 1, 5); usage limits → Redis meter (Task 2) enforced at session creation with `402` (Tasks 4, 6); faturamento → `buildInvoice` + `GET /billing/invoice` (Tasks 1, 4, 5). Real payment charging is explicitly deferred (future #4b: `PaymentPort` + Stripe).
- **Type consistency:** `Plan`/`PLANS`/`getPlan`/`isValidPlanId`/`DEFAULT_PLAN_ID` (Task 1) used by `BillingService` + controller; `Invoice`/`buildInvoice` (Task 1) returned by `getCurrentInvoice`; `UsageService.increment/current` + `monthKey` (Task 2) used by `BillingService` + `SessionController`; `RedisLike.get` (Task 2) implemented by `IoRedisAdapter` and the two in-test fakes; `tenant.planId` (Task 3) read by `getPlan`. `req.tenant` is set by `ApiKeyGuard`.
- **Quota counts at the authenticated boundary** (`POST /sessions`), avoiding the single-use-session-consumption ordering problem on `/verify`; the billable unit is a verification start.
- **Isolation:** usage keys are per-tenant (`usage:{tenantId}:{month}`); plan changes scoped by tenant id; quota check loads the tenant by id.
- **No placeholders:** every code step is complete; no new runtime dependency (reuses `ioredis`).
- **DB-dependent steps:** migration 0004 run (Task 3) + the smoke (Task 7) need infra; all logic is unit-tested with fakes/mocks. The interface change to `RedisLike` is the one cross-cutting edit — Task 2 updates the two existing fakes so the suite stays green.
```
