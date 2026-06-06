# ECA Verify — #1 Core Multi-Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the seeded single-tenant MVP into a real multi-tenant SaaS core: self-service tenant registration, an `api_keys` table supporting multiple keys with rotation + revocation, and AES-256-GCM encryption of tenant webhook secrets at rest.

**Architecture:** API keys move out of the `tenants` table into a dedicated `api_keys` table (`key_hash`, `revoked_at`), so a tenant can hold several keys and rotate/revoke without losing identity. The `ApiKeyGuard` resolves the tenant via the active (non-revoked) key. Webhook secrets are stored encrypted (AES-256-GCM) and decrypted only at the single consumption point (the worker, when dispatching the webhook). Registration is a public endpoint that returns the first API key exactly once.

**Tech Stack:** Builds on the existing monorepo (NestJS, TypeORM/Postgres, Jest). Reuses `crypto.util` patterns, `hashApiKey`/`extractBearer`, the `ApiKeyGuard`, the `Tenant` entity, and the worker `VerificationProcessor`.

> **Reuses existing code:** `apps/api/src/tenant/api-key.guard.ts` (`extractBearer`, `hashApiKey`), `apps/api/src/config.ts` (`encryptionKey`), `apps/api/src/tenant/tenant.entity.ts`, `apps/api/src/verification/verification.processor.ts`, `apps/api/scripts/seed-tenant.ts`, the RLS migration pattern in `apps/api/src/db/migrations/0001-init-rls.ts`.

---

## File Structure

```
apps/api/
├── src/
│   ├── tenant/
│   │   ├── api-key.entity.ts        # NEW: api_keys table
│   │   ├── api-key.service.ts       # NEW: generate/issue/rotate/revoke/resolve (TDD)
│   │   ├── api-key.guard.ts         # MODIFIED: resolve tenant via api_keys
│   │   ├── secret-crypto.ts         # NEW: AES-256-GCM encrypt/decrypt of secrets (TDD)
│   │   ├── tenant.service.ts        # NEW: register a tenant (TDD for the pure parts)
│   │   ├── tenant.controller.ts     # NEW: POST /tenants/register + key mgmt endpoints
│   │   ├── tenant.entity.ts         # MODIFIED: drop apiKeyHash; secret now stored encrypted
│   │   └── tenant.module.ts         # MODIFIED: register new providers/controller
│   ├── db/migrations/
│   │   └── 0002-api-keys.ts         # NEW: api_keys table + data move + drop column
│   ├── verification/
│   │   └── verification.processor.ts # MODIFIED: decrypt webhook secret before use
│   └── ...
└── scripts/seed-tenant.ts           # MODIFIED: use api_keys + encrypted secret
```

---

## Task 1: Secret crypto (AES-256-GCM at rest)

**Files:**
- Create: `apps/api/src/tenant/secret-crypto.ts`
- Test: `apps/api/src/tenant/secret-crypto.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/tenant/secret-crypto.spec.ts`
```ts
import { encryptSecret, decryptSecret } from './secret-crypto';

const key = Buffer.alloc(32, 9); // 256-bit test key

test('round-trips a secret through encrypt/decrypt', () => {
  const token = encryptSecret('whsec_abc123', key);
  expect(token).not.toContain('whsec_abc123'); // ciphertext, not plaintext
  expect(decryptSecret(token, key)).toBe('whsec_abc123');
});

test('produces a different ciphertext each time (random iv)', () => {
  expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
});

test('tampered token fails authentication', () => {
  const token = encryptSecret('x', key);
  const parts = token.split('.');
  const badCt = Buffer.from(parts[2], 'base64');
  badCt[0] ^= 0xff;
  const tampered = `${parts[0]}.${parts[1]}.${badCt.toString('base64')}`;
  expect(() => decryptSecret(tampered, key)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest secret-crypto`
Expected: FAIL — cannot find './secret-crypto'

- [ ] **Step 3: Write `apps/api/src/tenant/secret-crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Token format: base64(iv).base64(tag).base64(ciphertext)
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecret(token: string, key: Buffer): string {
  const [ivB64, tagB64, ctB64] = token.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('decryptSecret: malformed token');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest secret-crypto`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tenant/secret-crypto.ts apps/api/src/tenant/secret-crypto.spec.ts
git commit -m "feat(tenant): AES-256-GCM secret encryption at rest"
```

---

## Task 2: ApiKey entity

**Files:**
- Create: `apps/api/src/tenant/api-key.entity.ts`

> No unit test (a TypeORM entity declaration). Verified by compile + the service tests that follow.

- [ ] **Step 1: Write `apps/api/src/tenant/api-key.entity.ts`**

```ts
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Index({ unique: true })
  @Column({ name: 'key_hash' }) keyHash!: string;
  @Column({ nullable: true, type: 'text' }) label!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
}
```

- [ ] **Step 2: Verify it compiles (register it in the data source first — see Task 5 wiring; for now just typecheck the file)**

Run: `npx tsc --noEmit apps/api/src/tenant/api-key.entity.ts`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/tenant/api-key.entity.ts
git commit -m "feat(tenant): api_keys entity"
```

---

## Task 3: ApiKey service (generate / issue / rotate / revoke / resolve)

**Files:**
- Create: `apps/api/src/tenant/api-key.service.ts`
- Test: `apps/api/src/tenant/api-key.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/tenant/api-key.service.spec.ts`
```ts
import { ApiKeyService } from './api-key.service';

test('generate returns an sk_ key and its sha256 hash', () => {
  const { key, hash } = ApiKeyService.generate();
  expect(key.startsWith('sk_')).toBe(true);
  expect(hash).toHaveLength(64);
  expect(hash).not.toBe(key);
});

test('issue persists a hashed key row and returns the plaintext once', async () => {
  const saved: any[] = [];
  const repo = { save: jest.fn(async (r) => { saved.push(r); return r; }) };
  const svc = new ApiKeyService(repo as any, {} as any);
  const result = await svc.issue('tenant-1', 'ci');
  expect(result.key.startsWith('sk_')).toBe(true);
  expect(saved[0].tenantId).toBe('tenant-1');
  expect(saved[0].keyHash).toHaveLength(64);
  expect(saved[0].revokedAt).toBeNull();
  expect(saved[0]).not.toHaveProperty('key'); // never persist plaintext
});

test('revoke sets revoked_at for a key owned by the tenant', async () => {
  const repo = { update: jest.fn(async () => ({ affected: 1 })) };
  const svc = new ApiKeyService(repo as any, {} as any);
  await svc.revoke('key-1', 'tenant-1');
  expect(repo.update).toHaveBeenCalledWith(
    { id: 'key-1', tenantId: 'tenant-1', revokedAt: expect.anything() },
    expect.objectContaining({ revokedAt: expect.any(Date) }),
  );
});

test('resolveTenant returns null when the key is unknown or revoked', async () => {
  const apiKeyRepo = { findOne: jest.fn(async () => null) };
  const tenantRepo = { findOne: jest.fn() };
  const svc = new ApiKeyService(apiKeyRepo as any, tenantRepo as any);
  expect(await svc.resolveTenant('sk_whatever')).toBeNull();
  expect(tenantRepo.findOne).not.toHaveBeenCalled();
});

test('resolveTenant returns the tenant for an active key', async () => {
  const apiKeyRepo = { findOne: jest.fn(async () => ({ tenantId: 'tenant-1', revokedAt: null })) };
  const tenantRepo = { findOne: jest.fn(async () => ({ id: 'tenant-1', name: 'Acme' })) };
  const svc = new ApiKeyService(apiKeyRepo as any, tenantRepo as any);
  const tenant = await svc.resolveTenant('sk_active');
  expect(tenant).toEqual({ id: 'tenant-1', name: 'Acme' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest api-key.service`
Expected: FAIL — cannot find './api-key.service'

- [ ] **Step 3: Write `apps/api/src/tenant/api-key.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { ApiKey } from './api-key.entity';
import { Tenant } from './tenant.entity';

export interface GeneratedKey {
  key: string;
  hash: string;
}

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  static generate(): GeneratedKey {
    const key = 'sk_' + randomBytes(24).toString('hex');
    const hash = createHash('sha256').update(key).digest('hex');
    return { key, hash };
  }

  async issue(tenantId: string, label: string | null = null): Promise<{ id: string; key: string }> {
    const { key, hash } = ApiKeyService.generate();
    const row: ApiKey = {
      id: randomUUID(),
      tenantId,
      keyHash: hash,
      label,
      createdAt: new Date(),
      revokedAt: null,
    };
    await this.keys.save(row);
    return { id: row.id, key };
  }

  async revoke(id: string, tenantId: string): Promise<void> {
    await this.keys.update({ id, tenantId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async resolveTenant(presentedKey: string): Promise<Tenant | null> {
    const hash = createHash('sha256').update(presentedKey).digest('hex');
    const row = await this.keys.findOne({ where: { keyHash: hash, revokedAt: IsNull() } });
    if (!row) return null;
    return this.tenants.findOne({ where: { id: row.tenantId } });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest api-key.service`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tenant/api-key.service.ts apps/api/src/tenant/api-key.service.spec.ts
git commit -m "feat(tenant): api key service (generate/issue/revoke/resolve)"
```

---

## Task 4: Refactor ApiKeyGuard to use the api_keys table

**Files:**
- Modify: `apps/api/src/tenant/api-key.guard.ts`
- Test: `apps/api/src/tenant/api-key.guard.spec.ts` (existing — keep the pure-function tests passing)

- [ ] **Step 1: Replace the `ApiKeyGuard` class in `apps/api/src/tenant/api-key.guard.ts`**

Keep the existing `extractBearer` and `hashApiKey` exported functions UNCHANGED (the rate-limit guard depends on them). Replace ONLY the `@Injectable() class ApiKeyGuard {...}` with:
```ts
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers['authorization']);
    if (!token) throw new UnauthorizedException('missing api key');
    const tenant = await this.apiKeys.resolveTenant(token);
    if (!tenant) throw new UnauthorizedException('invalid api key');
    req.tenant = tenant;
    return true;
  }
}
```

- [ ] **Step 2: Fix imports at the top of the file**

Remove the now-unused `@InjectRepository`/`Repository`/`Tenant` imports IF they are no longer referenced, and add:
```ts
import { ApiKeyService } from './api-key.service';
```
Keep `createHash` import only if `hashApiKey` still uses it (it does).

- [ ] **Step 3: Run the guard tests + full suite to verify nothing broke**

Run: `npx jest api-key.guard`
Expected: PASS (the existing `extractBearer`/`hashApiKey` tests are unchanged and still pass).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/tenant/api-key.guard.ts
git commit -m "refactor(tenant): guard resolves tenant via api_keys table"
```

---

## Task 5: Tenant entity + module wiring (register ApiKey everywhere)

**Files:**
- Modify: `apps/api/src/tenant/tenant.entity.ts`, `apps/api/src/tenant/tenant.module.ts`, `apps/api/src/db/data-source.ts`, `apps/api/src/app.module.ts`

- [ ] **Step 1: Update `apps/api/src/tenant/tenant.entity.ts` — drop `apiKeyHash`**

Replace the entity body so it no longer holds the API key (keys now live in `api_keys`); `webhookSecret` now stores an encrypted token:
```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ name: 'webhook_url' }) webhookUrl!: string;
  // Stored encrypted (AES-256-GCM token) via secret-crypto; decrypted only at dispatch time.
  @Column({ name: 'webhook_secret' }) webhookSecret!: string;
}
```

- [ ] **Step 2: Update `apps/api/src/tenant/tenant.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { ApiKey } from './api-key.entity';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, ApiKey])],
  controllers: [TenantController],
  providers: [ApiKeyGuard, ApiKeyService, TenantService],
  exports: [ApiKeyGuard, ApiKeyService, TypeOrmModule],
})
export class TenantModule {}
```

- [ ] **Step 3: Register `ApiKey` in `apps/api/src/db/data-source.ts`**

Add `import { ApiKey } from '../tenant/api-key.entity';` and add `ApiKey` to the `entities` array (alongside `Tenant`, `VerificationSession`, `AuditLog`).

- [ ] **Step 4: Register `ApiKey` in `apps/api/src/app.module.ts`**

Add `import { ApiKey } from './tenant/api-key.entity';` and add `ApiKey` to the `entities` array of `TypeOrmModule.forRoot({...})`.

- [ ] **Step 5: Verify it compiles (will fail until Task 6 creates TenantService/Controller — that's expected; run after Task 6).**

Note: this task's files reference `TenantService` and `TenantController` created in Task 6. Implement Task 6 immediately after, then run `npx tsc -b apps/api`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tenant/tenant.entity.ts apps/api/src/tenant/tenant.module.ts apps/api/src/db/data-source.ts apps/api/src/app.module.ts
git commit -m "refactor(tenant): drop apiKeyHash, register ApiKey entity"
```

---

## Task 6: Tenant registration + key management (service + controller)

**Files:**
- Create: `apps/api/src/tenant/tenant.service.ts` (+ test), `apps/api/src/tenant/tenant.controller.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/tenant/tenant.service.spec.ts`
```ts
import { TenantService } from './tenant.service';
import { decryptSecret } from './secret-crypto';

const key = Buffer.alloc(32, 9);

test('register persists a tenant with an ENCRYPTED webhook secret and issues a first key', async () => {
  const savedTenants: any[] = [];
  const tenantRepo = { save: jest.fn(async (t) => { savedTenants.push(t); return t; }) };
  const apiKeys = { issue: jest.fn(async () => ({ id: 'k1', key: 'sk_first' })) };
  const svc = new TenantService(tenantRepo as any, apiKeys as any, key);

  const result = await svc.register({ name: 'Acme', webhookUrl: 'https://acme.test/hook' });

  expect(result.api_key).toBe('sk_first');
  expect(savedTenants[0].name).toBe('Acme');
  // secret stored encrypted, recoverable with the key, never plaintext
  expect(savedTenants[0].webhookSecret).not.toContain('.');// sanity: it's our token format (contains dots actually)
  const recovered = decryptSecret(savedTenants[0].webhookSecret, key);
  expect(recovered.length).toBeGreaterThan(0);
  expect(apiKeys.issue).toHaveBeenCalledWith(savedTenants[0].id, 'default');
});
```
Note: delete the misleading `not.toContain('.')` assertion line — the token DOES contain dots. Keep only the `decryptSecret` round-trip assertions. (Final test below.)

Use this exact test instead:
```ts
import { TenantService } from './tenant.service';
import { decryptSecret } from './secret-crypto';

const key = Buffer.alloc(32, 9);

test('register persists a tenant with an ENCRYPTED webhook secret and issues a first key', async () => {
  const savedTenants: any[] = [];
  const tenantRepo = { save: jest.fn(async (t) => { savedTenants.push(t); return t; }) };
  const apiKeys = { issue: jest.fn(async () => ({ id: 'k1', key: 'sk_first' })) };
  const svc = new TenantService(tenantRepo as any, apiKeys as any, key);

  const result = await svc.register({ name: 'Acme', webhookUrl: 'https://acme.test/hook' });

  expect(result.api_key).toBe('sk_first');
  expect(result.tenant_id).toBe(savedTenants[0].id);
  expect(savedTenants[0].name).toBe('Acme');
  expect(savedTenants[0].webhookUrl).toBe('https://acme.test/hook');
  const recovered = decryptSecret(savedTenants[0].webhookSecret, key);
  expect(recovered.length).toBeGreaterThanOrEqual(16);
  expect(apiKeys.issue).toHaveBeenCalledWith(savedTenants[0].id, 'default');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tenant.service`
Expected: FAIL — cannot find './tenant.service'

- [ ] **Step 3: Write `apps/api/src/tenant/tenant.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID, randomBytes } from 'crypto';
import { Tenant } from './tenant.entity';
import { ApiKeyService } from './api-key.service';
import { encryptSecret } from './secret-crypto';
import { encryptionKey } from '../config';

export const SECRET_KEY = Symbol('SECRET_KEY');

export interface RegisterInput {
  name: string;
  webhookUrl: string;
}

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly apiKeys: ApiKeyService,
    @Inject(SECRET_KEY) private readonly key: Buffer = encryptionKey(process.env),
  ) {}

  async register(input: RegisterInput): Promise<{ tenant_id: string; api_key: string; webhook_secret: string }> {
    const rawSecret = 'whsec_' + randomBytes(24).toString('hex');
    const tenant: Tenant = {
      id: randomUUID(),
      name: input.name,
      webhookUrl: input.webhookUrl,
      webhookSecret: encryptSecret(rawSecret, this.key),
    };
    await this.tenants.save(tenant);
    const issued = await this.apiKeys.issue(tenant.id, 'default');
    return { tenant_id: tenant.id, api_key: issued.key, webhook_secret: rawSecret };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tenant.service`
Expected: PASS (1 test)

- [ ] **Step 5: Write `apps/api/src/tenant/tenant.controller.ts`**

```ts
import { BadRequestException, Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { ApiKeyService } from './api-key.service';
import { ApiKeyGuard } from './api-key.guard';

interface RegisterBody {
  name?: unknown;
  webhook_url?: unknown;
}

@Controller('tenants')
export class TenantController {
  constructor(
    private readonly tenants: TenantService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  @Post('register')
  async register(@Body() body: RegisterBody) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw new BadRequestException('name is required');
    }
    if (typeof body.webhook_url !== 'string' || !/^https?:\/\//.test(body.webhook_url)) {
      throw new BadRequestException('webhook_url must be an http(s) URL');
    }
    return this.tenants.register({ name: body.name.trim(), webhookUrl: body.webhook_url });
  }

  // Rotate = issue a new key (the caller authenticates with an existing key).
  @Post('me/api-keys')
  @UseGuards(ApiKeyGuard)
  async rotate(@Req() req: any) {
    const issued = await this.apiKeys.issue(req.tenant.id, 'rotated');
    return { id: issued.id, api_key: issued.key };
  }

  @Delete('me/api-keys/:id')
  @UseGuards(ApiKeyGuard)
  async revoke(@Req() req: any, @Param('id') id: string) {
    await this.apiKeys.revoke(id, req.tenant.id);
    return { revoked: id };
  }
}
```

- [ ] **Step 6: Verify the whole API compiles (this resolves Task 5's forward references)**

Run: `npx tsc -b apps/api`
Expected: no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tenant/tenant.service.ts apps/api/src/tenant/tenant.service.spec.ts apps/api/src/tenant/tenant.controller.ts
git commit -m "feat(tenant): self-service registration + api key rotate/revoke"
```

---

## Task 7: Decrypt webhook secret at the consumption point

**Files:**
- Modify: `apps/api/src/verification/verification.processor.ts`

> The secret is now stored encrypted; it must be decrypted before being handed to the webhook signer. The processor is the single consumer (it reads `tenant.webhookSecret` and passes it into `service.verify`).

- [ ] **Step 1: Add the decrypt at the processor**

In `apps/api/src/verification/verification.processor.ts`, add imports:
```ts
import { decryptSecret } from '../tenant/secret-crypto';
import { encryptionKey } from '../config';
```
Then, where the processor builds the `service.verify({...})` args, change the `webhookSecret` value from `tenant.webhookSecret` to the decrypted value:
```ts
          webhookSecret: decryptSecret(tenant.webhookSecret, encryptionKey(process.env)),
```
(Leave the RLS scope, frame handling, and `finally` deletion unchanged.)

- [ ] **Step 2: Verify it compiles and the full suite is green**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites pass (the processor spec mocks `service.verify`, and the test tenant's `webhookSecret` must now be an encrypted token — update the processor spec's `findOneOrFail` mock to return a tenant whose `webhookSecret` is `encryptSecret('s', someKey)` matching `APP_ENCRYPTION_KEY`, OR set `process.env.APP_ENCRYPTION_KEY` in the test and encrypt with that key).

- [ ] **Step 3: Update the processor spec to provide an encrypted secret**

In `apps/api/src/verification/verification.processor.spec.ts`, at the top add:
```ts
import { encryptSecret } from '../tenant/secret-crypto';
process.env.APP_ENCRYPTION_KEY = '09'.repeat(32); // 64 hex chars -> Buffer.alloc(32, 9)
```
Then in `fakeDataSource()` change the tenant returned by `findOneOrFail` so its secret is encrypted with that same key:
```ts
    findOneOrFail: jest.fn(async () => ({
      id: 'ten1',
      webhookUrl: 'http://hook',
      webhookSecret: encryptSecret('s', Buffer.alloc(32, 9)),
    })),
```
(The processor decrypts it back to `'s'` before calling `service.verify`, which is mocked, so the value is not otherwise asserted — this just keeps `decryptSecret` from throwing.)

- [ ] **Step 4: Run the full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/verification.processor.ts apps/api/src/verification/verification.processor.spec.ts
git commit -m "feat(verification): decrypt webhook secret at dispatch time"
```

---

## Task 8: Migration 0002 — api_keys table + data move

**Files:**
- Create: `apps/api/src/db/migrations/0002-api-keys.ts`

> Live run requires Postgres (handled by the infra setup). Create + commit the file; run it where a DB is available.

- [ ] **Step 1: Write `apps/api/src/db/migrations/0002-api-keys.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiKeys0002 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE api_keys (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        key_hash text NOT NULL UNIQUE,
        label text,
        created_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz
      )`);
    // Move any existing tenant API key hash into the new table.
    await q.query(`
      INSERT INTO api_keys (id, tenant_id, key_hash, label, created_at)
      SELECT gen_random_uuid(), id, api_key_hash, 'migrated', now()
      FROM tenants
      WHERE api_key_hash IS NOT NULL`);
    await q.query(`ALTER TABLE tenants DROP COLUMN api_key_hash`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants ADD COLUMN api_key_hash text`);
    await q.query(`
      UPDATE tenants t SET api_key_hash = k.key_hash
      FROM api_keys k WHERE k.tenant_id = t.id AND k.revoked_at IS NULL`);
    await q.query(`DROP TABLE api_keys`);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -b apps/api`
Expected: no type errors.

- [ ] **Step 3: Run the migration if a database is reachable**

Run: `npx typeorm-ts-node-commonjs migration:run -d apps/api/src/db/data-source.ts`
Expected: "Migration ApiKeys0002 has been executed successfully." If no DB is reachable, mark as DEFERRED and do not fabricate output.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/migrations/0002-api-keys.ts
git commit -m "feat(db): api_keys migration with data move"
```

---

## Task 9: Update the seed script

**Files:**
- Modify: `apps/api/scripts/seed-tenant.ts`

> The seed predates `api_keys` and encryption; update it to the new model so a fresh dev DB is usable.

- [ ] **Step 1: Replace `apps/api/scripts/seed-tenant.ts`**

```ts
import 'reflect-metadata';
import { randomUUID, randomBytes } from 'crypto';
import { AppDataSource } from '../src/db/data-source';
import { Tenant } from '../src/tenant/tenant.entity';
import { ApiKeyService } from '../src/tenant/api-key.service';
import { encryptSecret } from '../src/tenant/secret-crypto';
import { encryptionKey } from '../src/config';

async function main() {
  await AppDataSource.initialize();
  const key = encryptionKey(process.env);
  const rawSecret = 'whsec_' + randomBytes(24).toString('hex');
  const tenant: Tenant = {
    id: randomUUID(),
    name: 'Demo Tenant',
    webhookUrl: process.env.SEED_WEBHOOK_URL ?? 'http://localhost:4000/webhook',
    webhookSecret: encryptSecret(rawSecret, key),
  };
  await AppDataSource.getRepository(Tenant).save(tenant);

  const svc = new ApiKeyService(
    AppDataSource.getRepository((await import('../src/tenant/api-key.entity')).ApiKey),
    AppDataSource.getRepository(Tenant),
  );
  const issued = await svc.issue(tenant.id, 'seed');

  console.log('Tenant id:', tenant.id);
  console.log('API key (store now, not recoverable):', issued.key);
  console.log('Webhook secret (raw):', rawSecret);
  await AppDataSource.destroy();
}
main();
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit --esModuleInterop --experimentalDecorators --emitDecoratorMetadata apps/api/scripts/seed-tenant.ts`
Expected: no type errors (ignore "rootDir" notices; this script lives outside the api `tsconfig` include).

- [ ] **Step 3: Run the seed if a database is reachable**

Run: `npx ts-node apps/api/scripts/seed-tenant.ts`
Expected: prints tenant id + `sk_...` key + raw webhook secret. If no DB, mark DEFERRED.

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/seed-tenant.ts
git commit -m "chore(seed): use api_keys + encrypted webhook secret"
```

---

## Task 10: Registration smoke (manual)

**Files:**
- Create: `apps/api/test/tenant-smoke.md`

- [ ] **Step 1: Write `apps/api/test/tenant-smoke.md`**

````markdown
# Tenant core smoke (requires Postgres + the API running)

1. Run migrations 0001 + 0002, then start the API (`npx ts-node apps/api/src/main.ts`).
2. Register a tenant:
   ```bash
   curl -s -X POST http://localhost:3000/tenants/register -H "Content-Type: application/json" \
     -d '{"name":"Acme","webhook_url":"https://acme.test/hook"}'
   ```
   Expect 201 JSON with `tenant_id`, `api_key` (sk_...), `webhook_secret`.
3. Use the returned key to create a session (proves the api_keys lookup works):
   ```bash
   curl -s -X POST http://localhost:3000/sessions -H "Authorization: Bearer <api_key>" \
     -H "Content-Type: application/json" -d '{"user_hash":"u1"}'
   ```
   Expect 200 with a `session_token`.
4. Rotate: `POST /tenants/me/api-keys` with the current key → returns a new key. Both keys work.
5. Revoke the first key: `DELETE /tenants/me/api-keys/<id>` (authenticating with the second key) → the first key now returns 401 on `/sessions`.
6. Confirm the tenant row stores an ENCRYPTED secret:
   ```bash
   docker compose exec -T postgres psql -U eca -d eca_verify -c "SELECT webhook_secret FROM tenants LIMIT 1;"
   ```
   Expect a `base64.base64.base64` token, not a readable `whsec_...` value.
````

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest`
Expected: all suites pass, including new suites: secret-crypto, api-key.service, tenant.service.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/tenant-smoke.md
git commit -m "test(tenant): registration + key lifecycle smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage (PRD v0.2 #1 row):** self-service registration → Task 6 (`POST /tenants/register`); API key rotation → Task 6 (`POST /tenants/me/api-keys`); API key revocation → Task 6 (`DELETE /tenants/me/api-keys/:id`) + Task 3 (`revoke`); AES-256 secrets at rest → Tasks 1 (`secret-crypto`), 6 (encrypt on register), 7 (decrypt at dispatch), 9 (seed encrypts). api_keys table + guard resolution → Tasks 2, 3, 4, 8.
- **Cross-cutting consistency:** `ApiKeyService` constructor `(apiKeyRepo, tenantRepo)` is used identically in Task 3 tests, the guard (Task 4), and the seed (Task 9). `encryptSecret`/`decryptSecret` token format (`b64.b64.b64`) is produced in Task 1 and consumed in Tasks 6/7/9. `Tenant` entity no longer has `apiKeyHash` (Task 5) — the guard (Task 4) and seed (Task 9) were updated to not reference it. `encryptionKey(process.env)` reused from existing `config.ts`.
- **Migration ordering:** 0002 runs after 0001; it moves `tenants.api_key_hash` into `api_keys` before dropping the column, so the seeded MVP tenant keeps working.
- **No placeholders:** every code step has complete code. (Task 6 Step 1 shows the corrected final test; the first draft block is explicitly superseded.)
- **DB-dependent steps** (Task 8 run, Task 9 run, Task 10) are marked to DEFER cleanly if no Postgres is reachable.
```
