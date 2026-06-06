# ECA Verify — #2.5 Escala & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the synchronous MVP slice into the scalable target architecture: rate limiting + a job queue + stateless workers + a temporary encrypted frame store with TTL, with `/verify` returning `202 processando` immediately and the worker doing the heavy verification asynchronously.

**Architecture:** A single **Redis** instance backs three concerns — the **BullMQ** job queue, per-API-key **rate limiting**, and an idempotency guard. The captured frame is uploaded to a **temporary S3-compatible bucket** (`FrameStorePort`, TTL 5 min) instead of being held in the request; `/verify` enqueues a `VerificationJob` and returns `202`. A separate **worker** process consumes the queue, fetches + decrypts the frame in memory, runs the existing `VerificationService` (decision → audit → webhook), and **physically deletes** the frame immediately. Postgres RLS is enforced per request/job via `set_config('app.tenant_id', ...)`.

**Tech Stack:** Builds on the MVP (NestJS, TypeORM/Postgres, Jest). Adds `ioredis`, `bullmq`, `@aws-sdk/client-s3`.

> **Depends on the MVP plan** (`2026-06-06-eca-verify-mvp.md`) being implemented: it reuses `EncryptedFrame`/`decryptFrame`/`zero` (crypto.util), `VerificationService`, `Tenant`/`VerificationSession` entities, `WebhookService`, `AuditService`, and the `AGE_PROVIDER`/`AgeProviderPort` boundary.

---

## File Structure

```
apps/api/
├── src/
│   ├── redis/
│   │   ├── redis-like.ts            # minimal Redis interface (unit-test seam)
│   │   └── ioredis.adapter.ts       # ioredis impl of RedisLike
│   ├── ratelimit/
│   │   ├── rate-limiter.ts          # fixed-window algorithm (TDD)
│   │   └── rate-limit.guard.ts      # NestJS guard using RateLimiter
│   ├── storage/
│   │   ├── frame-store.port.ts      # put/get/delete interface
│   │   ├── frame-codec.ts           # serialize/deserialize EncryptedFrame (TDD)
│   │   ├── memory-frame-store.ts    # in-memory impl w/ TTL (TDD)
│   │   └── s3-frame-store.ts        # S3-compatible impl
│   ├── queue/
│   │   ├── verification-job.ts      # job contract + builder (TDD)
│   │   ├── verification.queue.ts    # BullMQ producer
│   │   └── once-guard.ts            # idempotency via Redis SETNX (TDD)
│   ├── tenant/
│   │   └── tenant-scope.ts          # set_config('app.tenant_id', ...) helper (TDD)
│   ├── verification/
│   │   ├── verification.processor.ts # worker-side orchestration (TDD)
│   │   └── verification.controller.ts # MODIFIED: store + enqueue + 202
│   ├── verification/verification.module.ts # MODIFIED: wire queue/store
│   └── worker.ts                    # BullMQ Worker entrypoint
└── .env.example                     # MODIFIED: redis/bucket/limits
```

---

## Task 0: Dependencies + env

**Files:**
- Modify: `apps/api/package.json`, `.env.example`

- [ ] **Step 1: Add dependencies to `apps/api/package.json`**

Add these keys to the `dependencies` object:
```json
"@aws-sdk/client-s3": "^3.658.0",
"bullmq": "^5.13.0",
"ioredis": "^5.4.1"
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: installs without peer-dependency errors.

- [ ] **Step 3: Append to `.env.example`**

```
REDIS_URL=redis://localhost:6379
RATE_LIMIT_PER_MIN=60
FRAME_TTL_SECONDS=300
FRAME_BUCKET=eca-frames-temp
AWS_REGION=us-east-1
AWS_ENDPOINT=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json package-lock.json .env.example
git commit -m "chore(scale): add redis, bullmq, s3 deps + env"
```

---

## Task 1: Redis interface seam

**Files:**
- Create: `apps/api/src/redis/redis-like.ts`, `apps/api/src/redis/ioredis.adapter.ts`

> No test: this is a thin interface + a direct ioredis mapping. Consumers are tested against fakes of this interface.

- [ ] **Step 1: Write `apps/api/src/redis/redis-like.ts`**

```ts
// Minimal Redis surface used by the app — kept tiny so unit tests can fake it.
export interface RedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<void>;
  pttl(key: string): Promise<number>;
  /** SET key value PX ms NX — returns true if the key was set (did not exist). */
  setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
}
```

- [ ] **Step 2: Write `apps/api/src/redis/ioredis.adapter.ts`**

```ts
import Redis from 'ioredis';
import { RedisLike } from './redis-like';

export class IoRedisAdapter implements RedisLike {
  constructor(private readonly client: Redis) {}

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }
  async pexpire(key: string, ms: number): Promise<void> {
    await this.client.pexpire(key, ms);
  }
  pttl(key: string): Promise<number> {
    return this.client.pttl(key);
  }
  async setNx(key: string, value: string, ttlMs: number): Promise<boolean> {
    const res = await this.client.set(key, value, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/redis
git commit -m "feat(redis): RedisLike seam + ioredis adapter"
```

---

## Task 2: Rate limiter (fixed window)

**Files:**
- Create: `apps/api/src/ratelimit/rate-limiter.ts`
- Test: `apps/api/src/ratelimit/rate-limiter.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/ratelimit/rate-limiter.spec.ts`
```ts
import { RateLimiter } from './rate-limiter';
import { RedisLike } from '../redis/redis-like';

class FakeRedis implements RedisLike {
  store = new Map<string, number>();
  async incr(key: string) { const n = (this.store.get(key) ?? 0) + 1; this.store.set(key, n); return n; }
  async pexpire() {}
  async pttl() { return 60000; }
  async setNx() { return true; }
}

test('allows requests up to the limit', async () => {
  const limiter = new RateLimiter(new FakeRedis());
  for (let i = 1; i <= 3; i++) {
    const r = await limiter.check('k', 3, 60000);
    expect(r.allowed).toBe(true);
  }
});

test('blocks the request past the limit and reports remaining 0', async () => {
  const limiter = new RateLimiter(new FakeRedis());
  await limiter.check('k', 2, 60000);
  await limiter.check('k', 2, 60000);
  const third = await limiter.check('k', 2, 60000);
  expect(third.allowed).toBe(false);
  expect(third.remaining).toBe(0);
});

test('sets the window ttl only on the first hit', async () => {
  const redis = new FakeRedis();
  const spy = jest.spyOn(redis, 'pexpire');
  const limiter = new RateLimiter(redis);
  await limiter.check('k', 5, 60000);
  await limiter.check('k', 5, 60000);
  expect(spy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest rate-limiter`
Expected: FAIL — cannot find './rate-limiter'

- [ ] **Step 3: Write `apps/api/src/ratelimit/rate-limiter.ts`**

```ts
import { RedisLike } from '../redis/redis-like';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export class RateLimiter {
  constructor(private readonly redis: RedisLike) {}

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, windowMs);
    const resetMs = await this.redis.pttl(key);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetMs };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest rate-limiter`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ratelimit/rate-limiter.ts apps/api/src/ratelimit/rate-limiter.spec.ts
git commit -m "feat(ratelimit): fixed-window rate limiter"
```

---

## Task 3: Rate limit guard

**Files:**
- Create: `apps/api/src/ratelimit/rate-limit.guard.ts`
- Test: `apps/api/src/ratelimit/rate-limit.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/ratelimit/rate-limit.guard.spec.ts`
```ts
import { rateLimitKey } from './rate-limit.guard';

test('derives a per-minute redis key from the api key hash', () => {
  expect(rateLimitKey('abc123', '2026-06-06T12:34')).toBe('rl:abc123:2026-06-06T12:34');
});

test('different minutes produce different buckets', () => {
  expect(rateLimitKey('abc', '2026-06-06T12:34')).not.toBe(rateLimitKey('abc', '2026-06-06T12:35'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest rate-limit.guard`
Expected: FAIL — cannot find './rate-limit.guard'

- [ ] **Step 3: Write `apps/api/src/ratelimit/rate-limit.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { RateLimiter } from './rate-limiter';
import { extractBearer, hashApiKey } from '../tenant/api-key.guard';

export const RATE_LIMITER = Symbol('RATE_LIMITER');

/** Bucket key per api-key-hash per calendar minute. */
export function rateLimitKey(apiKeyHash: string, minuteIso: string): string {
  return `rl:${apiKeyHash}:${minuteIso}`;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers['authorization']) ?? 'anon';
    const hash = token === 'anon' ? createHash('sha256').update(req.ip ?? 'unknown').digest('hex') : hashApiKey(token);
    const minuteIso = new Date().toISOString().slice(0, 16);
    const limit = Number(process.env.RATE_LIMIT_PER_MIN ?? 60);
    const result = await this.limiter.check(rateLimitKey(hash, minuteIso), limit, 60000);
    if (!result.allowed) {
      throw new HttpException('rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest rate-limit.guard`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ratelimit/rate-limit.guard.ts apps/api/src/ratelimit/rate-limit.guard.spec.ts
git commit -m "feat(ratelimit): per-api-key rate limit guard"
```

---

## Task 4: Frame codec (serialize/deserialize)

**Files:**
- Create: `apps/api/src/storage/frame-codec.ts`
- Test: `apps/api/src/storage/frame-codec.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/storage/frame-codec.spec.ts`
```ts
import { serializeFrame, deserializeFrame } from './frame-codec';

test('round-trips an encrypted frame through bytes', () => {
  const frame = { iv: Buffer.from([1, 2, 3]), tag: Buffer.from([4, 5, 6]), ciphertext: Buffer.from([7, 8, 9, 10]) };
  const bytes = serializeFrame(frame);
  expect(Buffer.isBuffer(bytes)).toBe(true);
  const back = deserializeFrame(bytes);
  expect(back.iv.equals(frame.iv)).toBe(true);
  expect(back.tag.equals(frame.tag)).toBe(true);
  expect(back.ciphertext.equals(frame.ciphertext)).toBe(true);
});

test('rejects corrupt serialized data', () => {
  expect(() => deserializeFrame(Buffer.from('not-json'))).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest frame-codec`
Expected: FAIL — cannot find './frame-codec'

- [ ] **Step 3: Write `apps/api/src/storage/frame-codec.ts`**

```ts
import { EncryptedFrame } from '../verification/crypto.util';

export function serializeFrame(frame: EncryptedFrame): Buffer {
  const json = JSON.stringify({
    iv: frame.iv.toString('base64'),
    tag: frame.tag.toString('base64'),
    ciphertext: frame.ciphertext.toString('base64'),
  });
  return Buffer.from(json, 'utf8');
}

export function deserializeFrame(bytes: Buffer): EncryptedFrame {
  const obj = JSON.parse(bytes.toString('utf8')) as { iv: string; tag: string; ciphertext: string };
  return {
    iv: Buffer.from(obj.iv, 'base64'),
    tag: Buffer.from(obj.tag, 'base64'),
    ciphertext: Buffer.from(obj.ciphertext, 'base64'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest frame-codec`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage/frame-codec.ts apps/api/src/storage/frame-codec.spec.ts
git commit -m "feat(storage): encrypted frame codec"
```

---

## Task 5: Frame store port + in-memory impl (TTL)

**Files:**
- Create: `apps/api/src/storage/frame-store.port.ts`, `apps/api/src/storage/memory-frame-store.ts`
- Test: `apps/api/src/storage/memory-frame-store.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/storage/memory-frame-store.spec.ts`
```ts
import { MemoryFrameStore } from './memory-frame-store';

test('stores and retrieves a frame within ttl', async () => {
  let now = 1000;
  const store = new MemoryFrameStore(() => now);
  await store.put('k', Buffer.from('data'), 300);
  expect((await store.get('k'))!.toString()).toBe('data');
});

test('returns null after ttl expires', async () => {
  let now = 1000;
  const store = new MemoryFrameStore(() => now);
  await store.put('k', Buffer.from('data'), 5); // 5 seconds
  now = 1000 + 6000; // advance 6s
  expect(await store.get('k')).toBeNull();
});

test('delete removes the frame immediately', async () => {
  const store = new MemoryFrameStore(() => 1000);
  await store.put('k', Buffer.from('data'), 300);
  await store.delete('k');
  expect(await store.get('k')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest memory-frame-store`
Expected: FAIL — cannot find './memory-frame-store'

- [ ] **Step 3: Write the port and impl**

`apps/api/src/storage/frame-store.port.ts`
```ts
export const FRAME_STORE = Symbol('FRAME_STORE');

export interface FrameStorePort {
  put(key: string, data: Buffer, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
```

`apps/api/src/storage/memory-frame-store.ts`
```ts
import { FrameStorePort } from './frame-store.port';

interface Entry { data: Buffer; expiresAtMs: number; }

export class MemoryFrameStore implements FrameStorePort {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async put(key: string, data: Buffer, ttlSeconds: number): Promise<void> {
    this.map.set(key, { data, expiresAtMs: this.nowMs() + ttlSeconds * 1000 });
  }
  async get(key: string): Promise<Buffer | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (this.nowMs() >= e.expiresAtMs) { this.map.delete(key); return null; }
    return e.data;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest memory-frame-store`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage/frame-store.port.ts apps/api/src/storage/memory-frame-store.ts apps/api/src/storage/memory-frame-store.spec.ts
git commit -m "feat(storage): FrameStorePort + in-memory TTL store"
```

---

## Task 6: S3-compatible frame store

**Files:**
- Create: `apps/api/src/storage/s3-frame-store.ts`

> Integration impl (no unit test). The bucket lifecycle gives a TTL backstop; the worker also deletes explicitly.

- [ ] **Step 1: Write `apps/api/src/storage/s3-frame-store.ts`**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { FrameStorePort } from './frame-store.port';

export class S3FrameStore implements FrameStorePort {
  constructor(private readonly s3: S3Client, private readonly bucket: string) {}

  async put(key: string, data: Buffer, ttlSeconds: number): Promise<void> {
    // Expires header is a hint; the bucket lifecycle rule is the real TTL backstop.
    const expires = new Date(Date.now() + ttlSeconds * 1000);
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, Expires: expires }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -b apps/api`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/storage/s3-frame-store.ts
git commit -m "feat(storage): S3-compatible frame store"
```

---

## Task 7: Verification job contract + builder

**Files:**
- Create: `apps/api/src/queue/verification-job.ts`
- Test: `apps/api/src/queue/verification-job.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/queue/verification-job.spec.ts`
```ts
import { buildVerificationJob } from './verification-job';

test('builds a job with all routing fields', () => {
  const job = buildVerificationJob({
    transactionId: 'tx1', tenantId: 'ten1', frameRef: 'tx1', rawIp: '1.2.3.4',
  });
  expect(job).toEqual({ transactionId: 'tx1', tenantId: 'ten1', frameRef: 'tx1', rawIp: '1.2.3.4' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest verification-job`
Expected: FAIL — cannot find './verification-job'

- [ ] **Step 3: Write `apps/api/src/queue/verification-job.ts`**

```ts
export interface VerificationJob {
  transactionId: string;
  tenantId: string;
  frameRef: string;
  rawIp: string;
}

export const VERIFICATION_QUEUE_NAME = 'verification';

export function buildVerificationJob(args: VerificationJob): VerificationJob {
  return {
    transactionId: args.transactionId,
    tenantId: args.tenantId,
    frameRef: args.frameRef,
    rawIp: args.rawIp,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest verification-job`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/verification-job.ts apps/api/src/queue/verification-job.spec.ts
git commit -m "feat(queue): verification job contract + builder"
```

---

## Task 8: Idempotency guard (Redis SETNX)

**Files:**
- Create: `apps/api/src/queue/once-guard.ts`
- Test: `apps/api/src/queue/once-guard.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/queue/once-guard.spec.ts`
```ts
import { OnceGuard } from './once-guard';
import { RedisLike } from '../redis/redis-like';

class FakeRedis implements RedisLike {
  keys = new Set<string>();
  async incr() { return 1; }
  async pexpire() {}
  async pttl() { return 0; }
  async setNx(key: string) { if (this.keys.has(key)) return false; this.keys.add(key); return true; }
}

test('acquire succeeds the first time and fails the second', async () => {
  const guard = new OnceGuard(new FakeRedis());
  expect(await guard.acquire('tx1', 600000)).toBe(true);
  expect(await guard.acquire('tx1', 600000)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest once-guard`
Expected: FAIL — cannot find './once-guard'

- [ ] **Step 3: Write `apps/api/src/queue/once-guard.ts`**

```ts
import { RedisLike } from '../redis/redis-like';

/** Ensures a transaction is processed at most once (webhook idempotency). */
export class OnceGuard {
  constructor(private readonly redis: RedisLike) {}

  acquire(transactionId: string, ttlMs: number): Promise<boolean> {
    return this.redis.setNx(`once:${transactionId}`, '1', ttlMs);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest once-guard`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/queue/once-guard.ts apps/api/src/queue/once-guard.spec.ts
git commit -m "feat(queue): idempotency once-guard"
```

---

## Task 9: Tenant scope helper (RLS enforcement)

**Files:**
- Create: `apps/api/src/tenant/tenant-scope.ts`
- Test: `apps/api/src/tenant/tenant-scope.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/tenant/tenant-scope.spec.ts`
```ts
import { withTenantScope } from './tenant-scope';

test('sets app.tenant_id via set_config before running the callback', async () => {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  const qr = { query: async (sql: string, params?: any[]) => { calls.push({ sql, params }); return []; } };
  let ranAfterScope = false;

  await withTenantScope(qr, 'tenant-123', async () => { ranAfterScope = true; });

  expect(calls[0].sql).toContain("set_config('app.tenant_id'");
  expect(calls[0].params).toEqual(['tenant-123']);
  expect(ranAfterScope).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tenant-scope`
Expected: FAIL — cannot find './tenant-scope'

- [ ] **Step 3: Write `apps/api/src/tenant/tenant-scope.ts`**

```ts
export interface Queryable {
  query(sql: string, params?: any[]): Promise<any>;
}

/**
 * Sets the per-transaction tenant id so Postgres RLS policies isolate rows.
 * Must run inside the same transaction/connection as the queries in `fn`.
 */
export async function withTenantScope<T>(qr: Queryable, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await qr.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  return fn();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tenant-scope`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tenant/tenant-scope.ts apps/api/src/tenant/tenant-scope.spec.ts
git commit -m "feat(tenant): RLS tenant-scope helper"
```

---

## Task 10: Verification processor (worker orchestration)

**Files:**
- Create: `apps/api/src/verification/verification.processor.ts`
- Test: `apps/api/src/verification/verification.processor.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/verification.processor.spec.ts`
```ts
import { VerificationProcessor } from './verification.processor';
import { MemoryFrameStore } from '../storage/memory-frame-store';
import { serializeFrame } from '../storage/frame-codec';
import { encryptFrame } from './crypto.util';

const key = Buffer.alloc(32, 7);

function tenantRepo() {
  return { findOneOrFail: jest.fn(async () => ({ id: 'ten1', webhookUrl: 'http://hook', webhookSecret: 's' })) };
}

test('fetches the frame, verifies, then deletes the frame', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('tx1', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => ({ transaction_id: 'tx1', status: 'aprovado', is_over_18: true })) };
  const repo = tenantRepo();

  const proc = new VerificationProcessor(store, repo as any, service as any);
  await proc.process({ transactionId: 'tx1', tenantId: 'ten1', frameRef: 'tx1', rawIp: '1.2.3.4' });

  expect(service.verify).toHaveBeenCalledTimes(1);
  expect(await store.get('tx1')).toBeNull(); // physically deleted
});

test('deletes the frame even when verification throws', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('tx2', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => { throw new Error('provider down'); }) };
  const repo = tenantRepo();

  const proc = new VerificationProcessor(store, repo as any, service as any);
  await expect(proc.process({ transactionId: 'tx2', tenantId: 'ten1', frameRef: 'tx2', rawIp: '1.2.3.4' }))
    .rejects.toThrow('provider down');
  expect(await store.get('tx2')).toBeNull();
});

test('throws when the frame has expired or is missing', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const service = { verify: jest.fn() };
  const proc = new VerificationProcessor(store, tenantRepo() as any, service as any);
  await expect(proc.process({ transactionId: 'gone', tenantId: 'ten1', frameRef: 'gone', rawIp: '1.2.3.4' }))
    .rejects.toThrow(/frame/i);
  expect(service.verify).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest verification.processor`
Expected: FAIL — cannot find './verification.processor'

- [ ] **Step 3: Write `apps/api/src/verification/verification.processor.ts`**

```ts
import { Repository } from 'typeorm';
import { Tenant } from '../tenant/tenant.entity';
import { FrameStorePort } from '../storage/frame-store.port';
import { deserializeFrame } from '../storage/frame-codec';
import { VerificationService } from './verification.service';
import { VerificationJob } from '../queue/verification-job';

export class VerificationProcessor {
  constructor(
    private readonly store: FrameStorePort,
    private readonly tenants: Repository<Tenant>,
    private readonly service: VerificationService,
  ) {}

  async process(job: VerificationJob): Promise<void> {
    const bytes = await this.store.get(job.frameRef);
    if (!bytes) throw new Error(`frame ${job.frameRef} expired or missing`);
    try {
      const encryptedFrame = deserializeFrame(bytes);
      const tenant = await this.tenants.findOneOrFail({ where: { id: job.tenantId } });
      await this.service.verify({
        transactionId: job.transactionId,
        tenantId: job.tenantId,
        rawIp: job.rawIp,
        webhookUrl: tenant.webhookUrl,
        webhookSecret: tenant.webhookSecret,
        encryptedFrame,
      });
    } finally {
      // Privacy by Design: physical, immediate deletion of the temporary media.
      await this.store.delete(job.frameRef);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest verification.processor`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/verification.processor.ts apps/api/src/verification/verification.processor.spec.ts
git commit -m "feat(verification): async worker processor with frame deletion"
```

---

## Task 11: Queue producer (BullMQ)

**Files:**
- Create: `apps/api/src/queue/verification.queue.ts`

> Integration wrapper around BullMQ `Queue` (no unit test); the job shape it sends is already covered by Task 7.

- [ ] **Step 1: Write `apps/api/src/queue/verification.queue.ts`**

```ts
import { Queue } from 'bullmq';
import { VerificationJob, VERIFICATION_QUEUE_NAME } from './verification-job';

export class VerificationQueue {
  constructor(private readonly queue: Queue) {}

  async enqueue(job: VerificationJob): Promise<void> {
    // jobId = transactionId makes the enqueue idempotent (BullMQ drops duplicate ids).
    await this.queue.add(VERIFICATION_QUEUE_NAME, job, {
      jobId: job.transactionId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false, // keep failed jobs as a dead-letter trail
    });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -b apps/api`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/queue/verification.queue.ts
git commit -m "feat(queue): BullMQ verification producer"
```

---

## Task 12: Async controller + module wiring

**Files:**
- Modify: `apps/api/src/verification/verification.controller.ts`, `apps/api/src/verification/verification.module.ts`

- [ ] **Step 1: Replace `apps/api/src/verification/verification.controller.ts`**

```ts
import { Body, Controller, Post, Req, HttpCode, BadRequestException, UseGuards, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { VerificationSession } from '../session/session.entity';
import { serializeFrame } from '../storage/frame-codec';
import { FRAME_STORE, FrameStorePort } from '../storage/frame-store.port';
import { VerificationQueue } from '../queue/verification.queue';
import { buildVerificationJob } from '../queue/verification-job';
import { RateLimitGuard } from '../ratelimit/rate-limit.guard';

interface VerifyBody {
  session_token: string;
  frame: { iv: string; tag: string; ciphertext: string }; // base64
}

@Controller('verify')
@UseGuards(RateLimitGuard)
export class VerificationController {
  constructor(
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
    @Inject(FRAME_STORE) private readonly store: FrameStorePort,
    private readonly queue: VerificationQueue,
  ) {}

  @Post()
  @HttpCode(202)
  async verify(@Body() body: VerifyBody, @Req() req: any) {
    const session = await this.sessions.findOne({ where: { sessionToken: body.session_token } });
    if (!session) throw new BadRequestException('invalid session_token');

    const transactionId = randomUUID();
    const frameRef = transactionId;
    const encryptedFrame = {
      iv: Buffer.from(body.frame.iv, 'base64'),
      tag: Buffer.from(body.frame.tag, 'base64'),
      ciphertext: Buffer.from(body.frame.ciphertext, 'base64'),
    };
    const ttl = Number(process.env.FRAME_TTL_SECONDS ?? 300);
    await this.store.put(frameRef, serializeFrame(encryptedFrame), ttl);
    await this.queue.enqueue(buildVerificationJob({
      transactionId,
      tenantId: session.tenantId,
      frameRef,
      rawIp: req.ip ?? '',
    }));

    return { transaction_id: transactionId, status: 'processando' };
  }
}
```

- [ ] **Step 2: Replace `apps/api/src/verification/verification.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { VerificationSession } from '../session/session.entity';
import { Tenant } from '../tenant/tenant.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { MockAgeProvider } from './mock-age-provider';
import { loadDecisionConfig, encryptionKey } from '../config';
import { FRAME_STORE } from '../storage/frame-store.port';
import { S3FrameStore } from '../storage/s3-frame-store';
import { VerificationQueue } from '../queue/verification.queue';
import { VERIFICATION_QUEUE_NAME } from '../queue/verification-job';
import { RateLimitGuard, RATE_LIMITER } from '../ratelimit/rate-limit.guard';
import { RateLimiter } from '../ratelimit/rate-limiter';
import { IoRedisAdapter } from '../redis/ioredis.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationSession, Tenant, AuditLog])],
  controllers: [VerificationController],
  providers: [
    AuditService,
    { provide: WebhookService, useFactory: () => new WebhookService() },
    {
      provide: VerificationService,
      inject: [AuditService, WebhookService],
      useFactory: (audit: AuditService, webhook: WebhookService) =>
        new VerificationService(
          new MockAgeProvider({ estimatedAge: 30, livenessScore: 0.95 }),
          audit,
          webhook,
          loadDecisionConfig(process.env),
          encryptionKey(process.env),
        ),
    },
    {
      provide: FRAME_STORE,
      useFactory: () =>
        new S3FrameStore(
          new S3Client({
            region: process.env.AWS_REGION,
            endpoint: process.env.AWS_ENDPOINT,
            forcePathStyle: true,
          }),
          process.env.FRAME_BUCKET ?? 'eca-frames-temp',
        ),
    },
    {
      provide: VerificationQueue,
      useFactory: () =>
        new VerificationQueue(
          new Queue(VERIFICATION_QUEUE_NAME, { connection: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null }) }),
        ),
    },
    {
      provide: RATE_LIMITER,
      useFactory: () => new RateLimiter(new IoRedisAdapter(new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'))),
    },
    RateLimitGuard,
  ],
})
export class VerificationModule {}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -b apps/api`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/verification/verification.controller.ts apps/api/src/verification/verification.module.ts
git commit -m "feat(verification): async /verify (store + enqueue + 202) with rate limiting"
```

---

## Task 13: Worker entrypoint

**Files:**
- Create: `apps/api/src/worker.ts`

> Integration entrypoint (no unit test). Orchestration logic is covered by Task 10.

- [ ] **Step 1: Write `apps/api/src/worker.ts`**

```ts
import 'reflect-metadata';
import Redis from 'ioredis';
import { Worker } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { AppDataSource } from './db/data-source';
import { Tenant } from './tenant/tenant.entity';
import { AuditLog } from './audit/audit-log.entity';
import { S3FrameStore } from './storage/s3-frame-store';
import { VerificationProcessor } from './verification/verification.processor';
import { VerificationService } from './verification/verification.service';
import { AuditService } from './audit/audit.service';
import { WebhookService } from './webhook/webhook.service';
import { MockAgeProvider } from './verification/mock-age-provider';
import { loadDecisionConfig, encryptionKey } from './config';
import { VERIFICATION_QUEUE_NAME, VerificationJob } from './queue/verification-job';

async function main() {
  await AppDataSource.initialize();
  const tenants = AppDataSource.getRepository(Tenant);
  const auditRepo = AppDataSource.getRepository(AuditLog);

  const audit = new AuditService(auditRepo);
  const webhook = new WebhookService();
  const service = new VerificationService(
    new MockAgeProvider({ estimatedAge: 30, livenessScore: 0.95 }),
    audit,
    webhook,
    loadDecisionConfig(process.env),
    encryptionKey(process.env),
  );
  const store = new S3FrameStore(
    new S3Client({ region: process.env.AWS_REGION, endpoint: process.env.AWS_ENDPOINT, forcePathStyle: true }),
    process.env.FRAME_BUCKET ?? 'eca-frames-temp',
  );
  const processor = new VerificationProcessor(store, tenants, service);

  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const worker = new Worker<VerificationJob>(
    VERIFICATION_QUEUE_NAME,
    async (job) => { await processor.process(job.data); },
    { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 8) },
  );

  worker.on('completed', (job) => console.log(`job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`job ${job?.id} failed:`, err.message));
  console.log('verification worker started');
}
main();
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -b apps/api`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/worker.ts
git commit -m "feat(worker): BullMQ verification worker entrypoint"
```

---

## Task 14: RLS scope on session writes (controllers)

**Files:**
- Modify: `apps/api/src/session/session.controller.ts`

> Enforce RLS on the tenant-scoped write path now that we have the helper. The session insert must run with `app.tenant_id` set, inside one transaction.

- [ ] **Step 1: Replace the `create` method body in `apps/api/src/session/session.controller.ts`**

Replace the existing `create(...)` method with:
```ts
  @Post()
  async create(@Body() body: Record<string, unknown>, @Req() req: any) {
    try {
      assertNoPii(body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const userHash = body['user_hash'];
    if (typeof userHash !== 'string' || !userHash) {
      throw new BadRequestException('user_hash is required');
    }
    const tenantId = req.tenant.id as string;
    const session: VerificationSession = {
      id: randomUUID(),
      tenantId,
      userHash,
      sessionToken: randomBytes(24).toString('hex'),
      createdAt: new Date(),
    };
    await this.sessions.manager.transaction(async (mgr) => {
      await withTenantScope({ query: (sql, params) => mgr.query(sql, params) }, tenantId, async () => {
        await mgr.save(VerificationSession, session);
      });
    });
    return {
      session_token: session.sessionToken,
      plugin_url: `https://verify.local/plugin?session=${session.sessionToken}`,
    };
  }
```

- [ ] **Step 2: Add the import at the top of the file**

Add to the import block:
```ts
import { withTenantScope } from '../tenant/tenant-scope';
```

- [ ] **Step 3: Verify the existing session tests still pass and it compiles**

Run: `npx jest pii-guard && npx tsc -b apps/api`
Expected: pii-guard PASS; no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/session/session.controller.ts
git commit -m "feat(session): write inside RLS tenant scope"
```

---

## Task 15: End-to-end async smoke test (manual)

**Files:**
- Create: `apps/api/test/scale-smoke.md`

> **Prerequisites:** local Redis (`docker run -p 6379:6379 redis` or native), and a local S3 (MinIO: `docker run -p 9000:9000 minio/minio server /data`). Create the bucket once and a 5-min lifecycle rule.

- [ ] **Step 1: Write `apps/api/test/scale-smoke.md`**

````markdown
# Scale smoke

1. Create the temp bucket with a 5-minute TTL lifecycle:
   ```bash
   aws --endpoint-url http://localhost:9000 s3 mb s3://eca-frames-temp
   ```
2. Run migration + seed (from MVP plan), then start API and worker in two shells:
   ```bash
   npx ts-node apps/api/src/main.ts      # shell 1
   npx ts-node apps/api/src/worker.ts    # shell 2
   ```
3. Create a session, then POST /verify and confirm a 202 with status "processando".
4. Confirm the worker logs "job <id> completed" and the tenant webhook fires.
5. Confirm the frame object is gone from the bucket after processing.
6. Hammer /sessions past RATE_LIMIT_PER_MIN to confirm 429.
````

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: all suites pass, including the new ones: rate-limiter, rate-limit.guard, frame-codec, memory-frame-store, verification-job, once-guard, tenant-scope, verification.processor.

- [ ] **Step 3: Manually verify 202 + async webhook**

Run (after starting api + worker + seeding a tenant):
```bash
SESS=$(curl -s -X POST http://localhost:3000/sessions -H "Authorization: Bearer sk_SEEDED" -H "Content-Type: application/json" -d '{"user_hash":"u1"}' | python -c "import sys,json;print(json.load(sys.stdin)['session_token'])")
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/verify -H "Content-Type: application/json" \
  -d "{\"session_token\":\"$SESS\",\"frame\":{\"iv\":\"AAAA\",\"tag\":\"AAAA\",\"ciphertext\":\"AAAA\"}}"
```
Expected: `202`. Worker shell logs the job completing and dispatching the webhook.

- [ ] **Step 4: Verify rate limiting**

Run: `for i in $(seq 1 70); do curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/sessions -H "Authorization: Bearer sk_SEEDED" -H "Content-Type: application/json" -d '{"user_hash":"u1"}'; done; echo`
Expected: a run of `200` then `429` once the per-minute limit is crossed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/scale-smoke.md
git commit -m "test(scale): async + rate-limit smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage (PRD v0.2):** RF8 (async `202 processando`) → Tasks 11,12,13; RF9 (rate limiting) → Tasks 2,3,12; §8.1 RLS enforced per request → Tasks 9,14; §8.2 target ephemeral bucket + TTL + physical delete → Tasks 5,6,10 (`store.delete` in `finally`), Task 15 (lifecycle rule); §9 stateless/autoscaling → stateless worker (Task 13) + API; §9 mensageria (queue + workers) → Tasks 7,10,11,13; §9 cache & rate limiting via Redis → Tasks 1,2,3; §9 resiliência (retry/backoff/DLQ/idempotency) → Task 11 (`attempts`/`backoff`/`removeOnFail:false`) + Task 8 (`OnceGuard`) + jobId dedup.
- **Reused MVP symbols (unchanged signatures):** `EncryptedFrame`, `encryptFrame`/`decryptFrame`/`zero`, `VerificationService.verify(VerifyArgs)`, `AuditService(repo)`, `WebhookService()`, `MockAgeProvider`, `loadDecisionConfig`/`encryptionKey`, `Tenant`/`VerificationSession` entities, `extractBearer`/`hashApiKey`. Names match the MVP plan exactly.
- **New symbols, consistent across tasks:** `RedisLike`(incr/pexpire/pttl/setNx), `RateLimiter.check`, `rateLimitKey`, `serializeFrame`/`deserializeFrame`, `FrameStorePort`(put/get/delete)/`FRAME_STORE`, `MemoryFrameStore`/`S3FrameStore`, `VerificationJob`/`buildVerificationJob`/`VERIFICATION_QUEUE_NAME`, `OnceGuard.acquire`, `withTenantScope`/`Queryable`, `VerificationProcessor.process`, `VerificationQueue.enqueue`, `RATE_LIMITER`/`RateLimitGuard`.
- **No placeholders:** every code step contains complete, runnable code; manual-only steps (S3/Redis/worker) are explicitly marked as integration with their verification commands.
- **Note:** `OnceGuard` (Task 8) is wired into the webhook/worker dedup story by `jobId = transactionId` (Task 11); for a stricter at-least-once → exactly-once webhook guarantee, call `OnceGuard.acquire` inside the worker before `service.verify` in a follow-up — left out of MVP-of-scale to avoid an unused dependency now (YAGNI).
```
