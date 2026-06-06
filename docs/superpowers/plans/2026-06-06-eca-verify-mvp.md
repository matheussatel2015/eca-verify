# ECA Verify — MVP Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a thin end-to-end slice of a B2B age-verification SaaS: a tenant calls the API, a browser plugin captures a face frame, the backend runs a (mocked) age/liveness check, applies a hybrid decision rule, and fires a signed webhook — storing only non-biometric audit metadata.

**Architecture:** NestJS API (TypeScript) in an npm-workspaces monorepo. Domain decision logic is a pure function (TDD). The AI engine is hidden behind an `AgeProviderPort` interface with a `MockAgeProvider`. PostgreSQL with Row-Level Security isolates tenants by `tenant_id`. The captured frame lives only in memory and is zeroed in a `finally` block — no code path persists it, and the audit table has no biometric column.

**Tech Stack:** Node.js 22, TypeScript 5, NestJS 10, Jest, TypeORM + PostgreSQL, Vanilla JS plugin (esbuild bundle), Node `crypto` (HMAC-SHA256, AES-256-GCM).

---

## File Structure

```
eca-verify/
├── package.json                         # npm workspaces root
├── tsconfig.base.json
├── jest.config.js
├── .env.example
├── packages/
│   └── sdk-types/
│       ├── package.json
│       └── src/index.ts                 # shared contracts (status, payloads)
├── apps/
│   └── api/
│       ├── src/
│       │   ├── main.ts                  # bootstrap (TLS note, helmet)
│       │   ├── app.module.ts
│       │   ├── config.ts                # decision config + env
│       │   ├── verification/
│       │   │   ├── decision.ts          # PURE hybrid rule (core)
│       │   │   ├── age-provider.port.ts # interface
│       │   │   ├── mock-age-provider.ts
│       │   │   ├── crypto.util.ts       # AES-256-GCM decrypt + zeroing
│       │   │   ├── verification.service.ts
│       │   │   └── verification.controller.ts
│       │   ├── tenant/
│       │   │   ├── tenant.entity.ts
│       │   │   ├── api-key.guard.ts
│       │   │   └── tenant.module.ts
│       │   ├── session/
│       │   │   ├── session.entity.ts
│       │   │   ├── session.controller.ts  # POST /sessions (rejects PII)
│       │   │   └── session.module.ts
│       │   ├── webhook/
│       │   │   ├── signature.util.ts    # HMAC-SHA256 (TDD)
│       │   │   └── webhook.service.ts   # signed POST + retry
│       │   ├── audit/
│       │   │   ├── audit-log.entity.ts  # NO biometric column
│       │   │   ├── ip-mask.util.ts      # TDD
│       │   │   └── audit.service.ts
│       │   └── db/
│       │       ├── data-source.ts
│       │       └── migrations/0001-init-rls.ts
│       ├── scripts/seed-tenant.ts
│       └── test/                        # *.spec.ts colocated under src
└── packages/
    └── plugin/
        ├── package.json
        ├── src/
        │   ├── consent.ts               # consent gate (TDD, jsdom)
        │   ├── payload.ts               # builds /verify payload (TDD)
        │   └── index.ts                 # camera capture + orchestration
        └── build.mjs                    # esbuild bundle
```

---

## Task 0: Monorepo scaffold + tooling

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `jest.config.js`, `.env.example`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "eca-verify",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "jest",
    "build": "tsc -b"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^22.5.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "baseUrl": "."
  }
}
```

- [ ] **Step 3: Create `jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages', '<rootDir>/apps'],
  testMatch: ['**/*.spec.ts'],
};
```

- [ ] **Step 4: Create `.env.example`**

```
DATABASE_URL=postgres://eca:eca@localhost:5432/eca_verify
APP_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
CUTOFF_AGE=18
DECISION_MARGIN=3
LIVENESS_THRESHOLD=0.8
```

- [ ] **Step 5: Install and commit**

Run: `npm install`
```bash
git add package.json tsconfig.base.json jest.config.js .env.example package-lock.json
git commit -m "chore: monorepo scaffold (workspaces, ts, jest)"
```

---

## Task 1: Shared contracts (`sdk-types`)

**Files:**
- Create: `packages/sdk-types/package.json`, `packages/sdk-types/src/index.ts`
- Test: `packages/sdk-types/src/index.spec.ts`

- [ ] **Step 1: Create `packages/sdk-types/package.json`**

```json
{
  "name": "@eca/sdk-types",
  "version": "0.0.1",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 2: Write the failing test**

`packages/sdk-types/src/index.spec.ts`
```ts
import { VERIFICATION_STATUSES, isVerificationStatus } from './index';

test('aprovado is a valid status', () => {
  expect(isVerificationStatus('aprovado')).toBe(true);
});

test('garbage is not a valid status', () => {
  expect(isVerificationStatus('foo')).toBe(false);
});

test('there are exactly three statuses', () => {
  expect(VERIFICATION_STATUSES).toHaveLength(3);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest sdk-types`
Expected: FAIL — cannot find module './index'

- [ ] **Step 4: Write `packages/sdk-types/src/index.ts`**

```ts
export const VERIFICATION_STATUSES = ['aprovado', 'reprovado', 'documento_requerido'] as const;
export type VerificationStatus = typeof VERIFICATION_STATUSES[number];

export function isVerificationStatus(v: unknown): v is VerificationStatus {
  return typeof v === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(v);
}

export interface AgeProviderResult {
  estimatedAge: number;
  livenessScore: number; // 0..1
}

export interface DecisionConfig {
  cutoffAge: number;
  margin: number;
  livenessThreshold: number;
}

export interface WebhookPayload {
  transaction_id: string;
  status: VerificationStatus;
  is_over_18: boolean;
}

// Fields that must NEVER appear in a session-open payload (PII guard).
export const FORBIDDEN_PII_FIELDS = ['nome', 'name', 'cpf', 'email', 'e_mail'] as const;
```

- [ ] **Step 5: Run test to verify it passes, then commit**

Run: `npx jest sdk-types`
Expected: PASS (3 tests)
```bash
git add packages/sdk-types
git commit -m "feat(sdk-types): shared verification contracts"
```

---

## Task 2: Hybrid decision rule (pure domain core)

**Files:**
- Create: `apps/api/src/verification/decision.ts`
- Test: `apps/api/src/verification/decision.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/decision.spec.ts`
```ts
import { decideVerification, isOver18 } from './decision';
import { DecisionConfig } from '@eca/sdk-types';

const cfg: DecisionConfig = { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 };

test('low liveness is always reprovado', () => {
  expect(decideVerification({ estimatedAge: 40, livenessScore: 0.5 }, cfg)).toBe('reprovado');
});

test('clearly above cutoff is aprovado', () => {
  expect(decideVerification({ estimatedAge: 25, livenessScore: 0.9 }, cfg)).toBe('aprovado');
});

test('clearly below cutoff is reprovado', () => {
  expect(decideVerification({ estimatedAge: 13, livenessScore: 0.9 }, cfg)).toBe('reprovado');
});

test('grey zone requires document', () => {
  expect(decideVerification({ estimatedAge: 19, livenessScore: 0.9 }, cfg)).toBe('documento_requerido');
});

test('is_over_18 is true only for aprovado', () => {
  expect(isOver18('aprovado')).toBe(true);
  expect(isOver18('documento_requerido')).toBe(false);
  expect(isOver18('reprovado')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest decision`
Expected: FAIL — cannot find './decision'

- [ ] **Step 3: Write `apps/api/src/verification/decision.ts`**

```ts
import { AgeProviderResult, DecisionConfig, VerificationStatus } from '@eca/sdk-types';

export function decideVerification(result: AgeProviderResult, cfg: DecisionConfig): VerificationStatus {
  if (result.livenessScore < cfg.livenessThreshold) return 'reprovado';
  if (result.estimatedAge >= cfg.cutoffAge + cfg.margin) return 'aprovado';
  if (result.estimatedAge < cfg.cutoffAge - cfg.margin) return 'reprovado';
  return 'documento_requerido';
}

export function isOver18(status: VerificationStatus): boolean {
  return status === 'aprovado';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest decision`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/decision.ts apps/api/src/verification/decision.spec.ts
git commit -m "feat(verification): hybrid age/liveness decision rule"
```

---

## Task 3: Age provider port + mock

**Files:**
- Create: `apps/api/src/verification/age-provider.port.ts`, `apps/api/src/verification/mock-age-provider.ts`
- Test: `apps/api/src/verification/mock-age-provider.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/mock-age-provider.spec.ts`
```ts
import { MockAgeProvider } from './mock-age-provider';

test('mock returns the configured result', async () => {
  const provider = new MockAgeProvider({ estimatedAge: 22, livenessScore: 0.95 });
  const result = await provider.analyze(Buffer.from('fake-frame'));
  expect(result).toEqual({ estimatedAge: 22, livenessScore: 0.95 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest mock-age-provider`
Expected: FAIL — cannot find './mock-age-provider'

- [ ] **Step 3: Write the interface and mock**

`apps/api/src/verification/age-provider.port.ts`
```ts
import { AgeProviderResult } from '@eca/sdk-types';

export const AGE_PROVIDER = Symbol('AGE_PROVIDER');

export interface AgeProviderPort {
  analyze(frame: Buffer): Promise<AgeProviderResult>;
}
```

`apps/api/src/verification/mock-age-provider.ts`
```ts
import { AgeProviderResult } from '@eca/sdk-types';
import { AgeProviderPort } from './age-provider.port';

export class MockAgeProvider implements AgeProviderPort {
  constructor(private readonly fixed: AgeProviderResult) {}
  async analyze(_frame: Buffer): Promise<AgeProviderResult> {
    return { ...this.fixed };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest mock-age-provider`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/age-provider.port.ts apps/api/src/verification/mock-age-provider.ts apps/api/src/verification/mock-age-provider.spec.ts
git commit -m "feat(verification): AgeProviderPort + MockAgeProvider"
```

---

## Task 4: Ephemeral frame crypto (decrypt in memory + zeroing)

**Files:**
- Create: `apps/api/src/verification/crypto.util.ts`
- Test: `apps/api/src/verification/crypto.util.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/crypto.util.spec.ts`
```ts
import { encryptFrame, decryptFrame, zero } from './crypto.util';

const key = Buffer.alloc(32, 7); // 256-bit test key

test('decrypt recovers the original plaintext', () => {
  const plain = Buffer.from('frame-bytes');
  const enc = encryptFrame(plain, key);
  const dec = decryptFrame(enc, key);
  expect(dec.toString()).toBe('frame-bytes');
});

test('zero wipes a buffer in place', () => {
  const b = Buffer.from('secret');
  zero(b);
  expect(b.every((byte) => byte === 0)).toBe(true);
});

test('tampered ciphertext fails authentication', () => {
  const enc = encryptFrame(Buffer.from('x'), key);
  enc.ciphertext[0] ^= 0xff;
  expect(() => decryptFrame(enc, key)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest crypto.util`
Expected: FAIL — cannot find './crypto.util'

- [ ] **Step 3: Write `apps/api/src/verification/crypto.util.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface EncryptedFrame {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function encryptFrame(plain: Buffer, key: Buffer): EncryptedFrame {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

export function decryptFrame(enc: EncryptedFrame, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, enc.iv);
  decipher.setAuthTag(enc.tag);
  return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]);
}

/** Overwrite a buffer's bytes with zero, in place. */
export function zero(buf: Buffer): void {
  buf.fill(0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest crypto.util`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/crypto.util.ts apps/api/src/verification/crypto.util.spec.ts
git commit -m "feat(verification): AES-256-GCM frame crypto with zeroing"
```

---

## Task 5: Webhook signature (HMAC-SHA256)

**Files:**
- Create: `apps/api/src/webhook/signature.util.ts`
- Test: `apps/api/src/webhook/signature.util.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/webhook/signature.util.spec.ts`
```ts
import { signPayload, verifySignature } from './signature.util';

const secret = 'tenant-webhook-secret';
const body = JSON.stringify({ transaction_id: '1', status: 'aprovado', is_over_18: true });

test('signature verifies against the same body and secret', () => {
  const sig = signPayload(body, secret);
  expect(verifySignature(body, sig, secret)).toBe(true);
});

test('signature fails when the body changes', () => {
  const sig = signPayload(body, secret);
  expect(verifySignature(body + 'x', sig, secret)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest signature.util`
Expected: FAIL — cannot find './signature.util'

- [ ] **Step 3: Write `apps/api/src/webhook/signature.util.ts`**

```ts
import { createHmac, timingSafeEqual } from 'crypto';

export function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = signPayload(body, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest signature.util`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/webhook/signature.util.ts apps/api/src/webhook/signature.util.spec.ts
git commit -m "feat(webhook): HMAC-SHA256 payload signing"
```

---

## Task 6: IP masking (audit helper)

**Files:**
- Create: `apps/api/src/audit/ip-mask.util.ts`
- Test: `apps/api/src/audit/ip-mask.util.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/audit/ip-mask.util.spec.ts`
```ts
import { maskIp } from './ip-mask.util';

test('masks the last octet of an IPv4 address', () => {
  expect(maskIp('200.158.4.27')).toBe('200.158.4.0');
});

test('masks the host half of an IPv6 address', () => {
  expect(maskIp('2001:db8:85a3:1:2:3:4:5')).toBe('2001:db8:85a3:1::');
});

test('returns unknown for empty input', () => {
  expect(maskIp('')).toBe('unknown');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest ip-mask`
Expected: FAIL — cannot find './ip-mask.util'

- [ ] **Step 3: Write `apps/api/src/audit/ip-mask.util.ts`**

```ts
export function maskIp(ip: string): string {
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':') + '::';
  }
  const octets = ip.split('.');
  if (octets.length !== 4) return 'unknown';
  octets[3] = '0';
  return octets.join('.');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest ip-mask`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit/ip-mask.util.ts apps/api/src/audit/ip-mask.util.spec.ts
git commit -m "feat(audit): IP masking helper"
```

---

## Task 7: NestJS bootstrap + config + entities

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/config.ts`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/tenant/tenant.entity.ts`, `apps/api/src/session/session.entity.ts`, `apps/api/src/audit/audit-log.entity.ts`, `apps/api/src/db/data-source.ts`
- Test: `apps/api/src/config.spec.ts`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@eca/api",
  "version": "0.0.1",
  "dependencies": {
    "@eca/sdk-types": "0.0.1",
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/typeorm": "^10.0.2",
    "helmet": "^7.1.0",
    "pg": "^8.12.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "typeorm": "^0.3.20"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write the failing config test**

`apps/api/src/config.spec.ts`
```ts
import { loadDecisionConfig } from './config';

test('reads decision config from env with defaults', () => {
  const cfg = loadDecisionConfig({ CUTOFF_AGE: '18', DECISION_MARGIN: '3', LIVENESS_THRESHOLD: '0.8' });
  expect(cfg).toEqual({ cutoffAge: 18, margin: 3, livenessThreshold: 0.8 });
});

test('falls back to defaults when env is absent', () => {
  const cfg = loadDecisionConfig({});
  expect(cfg).toEqual({ cutoffAge: 18, margin: 3, livenessThreshold: 0.8 });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest config`
Expected: FAIL — cannot find './config'

- [ ] **Step 5: Write `apps/api/src/config.ts`**

```ts
import { DecisionConfig } from '@eca/sdk-types';

export function loadDecisionConfig(env: NodeJS.ProcessEnv): DecisionConfig {
  return {
    cutoffAge: Number(env.CUTOFF_AGE ?? 18),
    margin: Number(env.DECISION_MARGIN ?? 3),
    livenessThreshold: Number(env.LIVENESS_THRESHOLD ?? 0.8),
  };
}

export function encryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const hex = env.APP_ENCRYPTION_KEY ?? '';
  if (hex.length !== 64) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return Buffer.from(hex, 'hex');
}
```

- [ ] **Step 6: Run config test to verify it passes**

Run: `npx jest config`
Expected: PASS (2 tests)

- [ ] **Step 7: Write the three entities**

`apps/api/src/tenant/tenant.entity.ts`
```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ name: 'api_key_hash' }) apiKeyHash!: string;
  @Column({ name: 'webhook_url' }) webhookUrl!: string;
  @Column({ name: 'webhook_secret' }) webhookSecret!: string;
}
```

`apps/api/src/session/session.entity.ts`
```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('sessions')
export class VerificationSession {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'user_hash' }) userHash!: string;
  @Column({ name: 'session_token' }) sessionToken!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
```

`apps/api/src/audit/audit-log.entity.ts`
```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

// NOTE: by design this entity has NO biometric/image column. Do not add one.
@Entity('audit_logs')
export class AuditLog {
  @PrimaryColumn('uuid') id!: string; // transaction_id
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'masked_ip' }) maskedIp!: string;
  @Column() status!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
```

- [ ] **Step 8: Write `apps/api/src/db/data-source.ts`**

```ts
import { DataSource } from 'typeorm';
import { Tenant } from '../tenant/tenant.entity';
import { VerificationSession } from '../session/session.entity';
import { AuditLog } from '../audit/audit-log.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Tenant, VerificationSession, AuditLog],
  migrations: ['src/db/migrations/*.ts'],
  synchronize: false,
});
```

- [ ] **Step 9: Write `apps/api/src/main.ts` and `apps/api/src/app.module.ts`**

`apps/api/src/app.module.ts`
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant/tenant.entity';
import { VerificationSession } from './session/session.entity';
import { AuditLog } from './audit/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Tenant, VerificationSession, AuditLog],
      synchronize: false,
    }),
  ],
})
export class AppModule {}
```

`apps/api/src/main.ts`
```ts
import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// TLS 1.3 is terminated at the reverse proxy (nginx/ALB) in front of this app.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  await app.listen(3000);
}
bootstrap();
```

- [ ] **Step 10: Install and commit**

Run: `npm install`
```bash
git add apps/api package-lock.json
git commit -m "feat(api): nest bootstrap, config, entities, data source"
```

---

## Task 8: RLS migration + tenant seed

**Files:**
- Create: `apps/api/src/db/migrations/0001-init-rls.ts`, `apps/api/scripts/seed-tenant.ts`

> **Prerequisite:** a local PostgreSQL reachable via `DATABASE_URL`. Create the db once: `createdb eca_verify` (or `CREATE DATABASE eca_verify;`).

- [ ] **Step 1: Write the migration**

`apps/api/src/db/migrations/0001-init-rls.ts`
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitRls0001 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await q.query(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        api_key_hash text NOT NULL,
        webhook_url text NOT NULL,
        webhook_secret text NOT NULL
      )`);
    await q.query(`
      CREATE TABLE sessions (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_hash text NOT NULL,
        session_token text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        masked_ip text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Row-Level Security: every row scoped to the current tenant.
    for (const t of ['sessions', 'audit_logs']) {
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY ${t}_isolation ON ${t}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS audit_logs`);
    await q.query(`DROP TABLE IF EXISTS sessions`);
    await q.query(`DROP TABLE IF EXISTS tenants`);
  }
}
```

- [ ] **Step 2: Run the migration**

Run: `npx typeorm-ts-node-commonjs migration:run -d apps/api/src/db/data-source.ts`
Expected: "Migration InitRls0001 has been executed successfully."

- [ ] **Step 3: Write the seed script**

`apps/api/scripts/seed-tenant.ts`
```ts
import 'reflect-metadata';
import { randomUUID, createHash, randomBytes } from 'crypto';
import { AppDataSource } from '../src/db/data-source';
import { Tenant } from '../src/tenant/tenant.entity';

async function main() {
  await AppDataSource.initialize();
  const apiKey = 'sk_' + randomBytes(24).toString('hex');
  const tenant: Tenant = {
    id: randomUUID(),
    name: 'Demo Tenant',
    apiKeyHash: createHash('sha256').update(apiKey).digest('hex'),
    webhookUrl: process.env.SEED_WEBHOOK_URL ?? 'http://localhost:4000/webhook',
    webhookSecret: randomBytes(16).toString('hex'),
  };
  await AppDataSource.getRepository(Tenant).save(tenant);
  console.log('Tenant id:', tenant.id);
  console.log('API key (store now, not recoverable):', apiKey);
  await AppDataSource.destroy();
}
main();
```

- [ ] **Step 4: Run the seed and capture the API key**

Run: `npx ts-node apps/api/scripts/seed-tenant.ts`
Expected: prints a tenant id and an `sk_...` API key. Save the key for manual testing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations apps/api/scripts/seed-tenant.ts
git commit -m "feat(db): RLS migration + tenant seed script"
```

---

## Task 9: API key guard + tenant context

**Files:**
- Create: `apps/api/src/tenant/api-key.guard.ts`, `apps/api/src/tenant/tenant.module.ts`
- Test: `apps/api/src/tenant/api-key.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/tenant/api-key.guard.spec.ts`
```ts
import { hashApiKey, extractBearer } from './api-key.guard';

test('extractBearer pulls the token out of the header', () => {
  expect(extractBearer('Bearer sk_abc')).toBe('sk_abc');
});

test('extractBearer returns null without the scheme', () => {
  expect(extractBearer('sk_abc')).toBeNull();
});

test('hashApiKey is deterministic sha256 hex', () => {
  expect(hashApiKey('sk_abc')).toBe(hashApiKey('sk_abc'));
  expect(hashApiKey('sk_abc')).toHaveLength(64);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest api-key.guard`
Expected: FAIL — cannot find './api-key.guard'

- [ ] **Step 3: Write `apps/api/src/tenant/api-key.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity';

export function extractBearer(header?: string): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers['authorization']);
    if (!token) throw new UnauthorizedException('missing api key');
    const tenant = await this.tenants.findOne({ where: { apiKeyHash: hashApiKey(token) } });
    if (!tenant) throw new UnauthorizedException('invalid api key');
    req.tenant = tenant;
    return true;
  }
}
```

- [ ] **Step 4: Write `apps/api/src/tenant/tenant.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { ApiKeyGuard } from './api-key.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard, TypeOrmModule],
})
export class TenantModule {}
```

- [ ] **Step 5: Run test, then commit**

Run: `npx jest api-key.guard`
Expected: PASS (3 tests)
```bash
git add apps/api/src/tenant/api-key.guard.ts apps/api/src/tenant/api-key.guard.spec.ts apps/api/src/tenant/tenant.module.ts
git commit -m "feat(tenant): api key guard + tenant context"
```

---

## Task 10: Session endpoint (PII guard)

**Files:**
- Create: `apps/api/src/session/pii-guard.util.ts`, `apps/api/src/session/session.controller.ts`, `apps/api/src/session/session.module.ts`
- Test: `apps/api/src/session/pii-guard.util.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/session/pii-guard.util.spec.ts`
```ts
import { assertNoPii } from './pii-guard.util';

test('passes a clean payload', () => {
  expect(() => assertNoPii({ user_hash: 'abc123' })).not.toThrow();
});

test('rejects a payload containing cpf', () => {
  expect(() => assertNoPii({ user_hash: 'abc', cpf: '00000000000' })).toThrow(/pii/i);
});

test('rejects a payload containing nome', () => {
  expect(() => assertNoPii({ user_hash: 'abc', nome: 'Maria' })).toThrow(/pii/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest pii-guard`
Expected: FAIL — cannot find './pii-guard.util'

- [ ] **Step 3: Write `apps/api/src/session/pii-guard.util.ts`**

```ts
import { FORBIDDEN_PII_FIELDS } from '@eca/sdk-types';

export function assertNoPii(payload: Record<string, unknown>): void {
  const keys = Object.keys(payload).map((k) => k.toLowerCase());
  for (const forbidden of FORBIDDEN_PII_FIELDS) {
    if (keys.includes(forbidden)) {
      throw new Error(`PII field "${forbidden}" is not allowed; send only user_hash`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest pii-guard`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the controller and module**

`apps/api/src/session/session.controller.ts`
```ts
import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID, randomBytes } from 'crypto';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { assertNoPii } from './pii-guard.util';
import { VerificationSession } from './session.entity';

@Controller('sessions')
@UseGuards(ApiKeyGuard)
export class SessionController {
  constructor(
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
  ) {}

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
    const session: VerificationSession = {
      id: randomUUID(),
      tenantId: req.tenant.id,
      userHash,
      sessionToken: randomBytes(24).toString('hex'),
      createdAt: new Date(),
    };
    await this.sessions.save(session);
    return {
      session_token: session.sessionToken,
      plugin_url: `https://verify.local/plugin?session=${session.sessionToken}`,
    };
  }
}
```

`apps/api/src/session/session.module.ts`
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationSession } from './session.entity';
import { SessionController } from './session.controller';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationSession]), TenantModule],
  controllers: [SessionController],
})
export class SessionModule {}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/session
git commit -m "feat(session): POST /sessions with PII guard"
```

---

## Task 11: Webhook service (signed POST + retry)

**Files:**
- Create: `apps/api/src/webhook/webhook.service.ts`
- Test: `apps/api/src/webhook/webhook.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/webhook/webhook.service.spec.ts`
```ts
import { WebhookService } from './webhook.service';
import { verifySignature } from './signature.util';
import { WebhookPayload } from '@eca/sdk-types';

test('sends a signed payload and succeeds on first try', async () => {
  const calls: any[] = [];
  const fetchMock = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: true, status: 200 } as any;
  });
  const svc = new WebhookService(fetchMock as any, { retries: 2, delayMs: 0 });
  const payload: WebhookPayload = { transaction_id: '1', status: 'aprovado', is_over_18: true };

  await svc.dispatch('http://hook', 'secret', payload);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const sig = calls[0].init.headers['X-Signature'];
  expect(verifySignature(calls[0].init.body, sig, 'secret')).toBe(true);
});

test('retries on failure then throws after exhausting retries', async () => {
  const fetchMock = jest.fn(async () => ({ ok: false, status: 500 } as any));
  const svc = new WebhookService(fetchMock as any, { retries: 2, delayMs: 0 });
  await expect(
    svc.dispatch('http://hook', 'secret', { transaction_id: '1', status: 'reprovado', is_over_18: false }),
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest webhook.service`
Expected: FAIL — cannot find './webhook.service'

- [ ] **Step 3: Write `apps/api/src/webhook/webhook.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { WebhookPayload } from '@eca/sdk-types';
import { signPayload } from './signature.util';

type FetchFn = (url: string, init: any) => Promise<{ ok: boolean; status: number }>;
interface RetryOpts { retries: number; delayMs: number; }

@Injectable()
export class WebhookService {
  constructor(
    private readonly fetchFn: FetchFn = fetch as any,
    private readonly opts: RetryOpts = { retries: 3, delayMs: 500 },
  ) {}

  async dispatch(url: string, secret: string, payload: WebhookPayload): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = signPayload(body, secret);
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
          body,
        });
        if (res.ok) return;
        lastErr = new Error(`webhook returned ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
      if (attempt < this.opts.retries && this.opts.delayMs > 0) {
        await new Promise((r) => setTimeout(r, this.opts.delayMs));
      }
    }
    throw lastErr ?? new Error('webhook failed');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest webhook.service`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/webhook/webhook.service.ts apps/api/src/webhook/webhook.service.spec.ts
git commit -m "feat(webhook): signed dispatch with retry"
```

---

## Task 12: Audit service (metadata only)

**Files:**
- Create: `apps/api/src/audit/audit.service.ts`
- Test: `apps/api/src/audit/audit.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/audit/audit.service.spec.ts`
```ts
import { AuditService } from './audit.service';

test('builds a metadata-only record (no biometric fields)', () => {
  const record = AuditService.buildRecord({
    transactionId: 'tx1',
    tenantId: 'ten1',
    rawIp: '200.158.4.27',
    status: 'aprovado',
    now: new Date('2026-06-06T12:00:00Z'),
  });
  expect(record).toEqual({
    id: 'tx1',
    tenantId: 'ten1',
    maskedIp: '200.158.4.0',
    status: 'aprovado',
    createdAt: new Date('2026-06-06T12:00:00Z'),
  });
  // Guard: no biometric/image keys ever leak into the record.
  expect(Object.keys(record)).not.toContain('frame');
  expect(Object.keys(record)).not.toContain('image');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest audit.service`
Expected: FAIL — cannot find './audit.service'

- [ ] **Step 3: Write `apps/api/src/audit/audit.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationStatus } from '@eca/sdk-types';
import { AuditLog } from './audit-log.entity';
import { maskIp } from './ip-mask.util';

interface BuildArgs {
  transactionId: string;
  tenantId: string;
  rawIp: string;
  status: VerificationStatus;
  now: Date;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  static buildRecord(args: BuildArgs): AuditLog {
    return {
      id: args.transactionId,
      tenantId: args.tenantId,
      maskedIp: maskIp(args.rawIp),
      status: args.status,
      createdAt: args.now,
    };
  }

  async record(args: BuildArgs): Promise<void> {
    await this.logs.save(AuditService.buildRecord(args));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest audit.service`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit/audit.service.ts apps/api/src/audit/audit.service.spec.ts
git commit -m "feat(audit): metadata-only audit service"
```

---

## Task 13: Verification service (wires the slice together)

**Files:**
- Create: `apps/api/src/verification/verification.service.ts`
- Test: `apps/api/src/verification/verification.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/verification.service.spec.ts`
```ts
import { VerificationService } from './verification.service';
import { MockAgeProvider } from './mock-age-provider';
import { encryptFrame } from './crypto.util';
import { DecisionConfig } from '@eca/sdk-types';

const key = Buffer.alloc(32, 7);
const cfg: DecisionConfig = { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 };

function makeService(age: number, liveness: number) {
  const audit = { record: jest.fn(async () => {}) };
  const webhook = { dispatch: jest.fn(async () => {}) };
  const provider = new MockAgeProvider({ estimatedAge: age, livenessScore: liveness });
  const svc = new VerificationService(provider, audit as any, webhook as any, cfg, key);
  return { svc, audit, webhook };
}

test('approves an adult and dispatches an aprovado webhook', async () => {
  const { svc, audit, webhook } = makeService(30, 0.95);
  const enc = encryptFrame(Buffer.from('frame'), key);
  const result = await svc.verify({
    transactionId: 'tx1', tenantId: 'ten1', rawIp: '1.2.3.4',
    webhookUrl: 'http://hook', webhookSecret: 's', encryptedFrame: enc,
  });
  expect(result.status).toBe('aprovado');
  expect(result.is_over_18).toBe(true);
  expect(audit.record).toHaveBeenCalledTimes(1);
  expect(webhook.dispatch).toHaveBeenCalledWith('http://hook', 's',
    expect.objectContaining({ transaction_id: 'tx1', status: 'aprovado', is_over_18: true }));
});

test('grey-zone result yields documento_requerido', async () => {
  const { svc } = makeService(19, 0.95);
  const enc = encryptFrame(Buffer.from('frame'), key);
  const result = await svc.verify({
    transactionId: 'tx2', tenantId: 'ten1', rawIp: '1.2.3.4',
    webhookUrl: 'http://hook', webhookSecret: 's', encryptedFrame: enc,
  });
  expect(result.status).toBe('documento_requerido');
  expect(result.is_over_18).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest verification.service`
Expected: FAIL — cannot find './verification.service'

- [ ] **Step 3: Write `apps/api/src/verification/verification.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { DecisionConfig, WebhookPayload } from '@eca/sdk-types';
import { AgeProviderPort } from './age-provider.port';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { decideVerification, isOver18 } from './decision';
import { decryptFrame, zero, EncryptedFrame } from './crypto.util';

interface VerifyArgs {
  transactionId: string;
  tenantId: string;
  rawIp: string;
  webhookUrl: string;
  webhookSecret: string;
  encryptedFrame: EncryptedFrame;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly provider: AgeProviderPort,
    private readonly audit: AuditService,
    private readonly webhook: WebhookService,
    private readonly cfg: DecisionConfig,
    private readonly key: Buffer,
  ) {}

  async verify(args: VerifyArgs): Promise<WebhookPayload> {
    const frame = decryptFrame(args.encryptedFrame, this.key);
    try {
      const providerResult = await this.provider.analyze(frame);
      const status = decideVerification(providerResult, this.cfg);
      const payload: WebhookPayload = {
        transaction_id: args.transactionId,
        status,
        is_over_18: isOver18(status),
      };
      await this.audit.record({
        transactionId: args.transactionId,
        tenantId: args.tenantId,
        rawIp: args.rawIp,
        status,
        now: new Date(),
      });
      await this.webhook.dispatch(args.webhookUrl, args.webhookSecret, payload);
      return payload;
    } finally {
      // Privacy by Design: the frame never outlives this call.
      zero(frame);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest verification.service`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/verification.service.ts apps/api/src/verification/verification.service.spec.ts
git commit -m "feat(verification): orchestration service with ephemeral frame handling"
```

---

## Task 14: Verification controller + wiring module

**Files:**
- Create: `apps/api/src/verification/verification.controller.ts`, `apps/api/src/verification/verification.module.ts`
- Modify: `apps/api/src/app.module.ts` (register modules)

- [ ] **Step 1: Write the controller**

`apps/api/src/verification/verification.controller.ts`
```ts
import { Body, Controller, Post, Req, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { VerificationSession } from '../session/session.entity';
import { Tenant } from '../tenant/tenant.entity';
import { VerificationService } from './verification.service';

interface VerifyBody {
  session_token: string;
  frame: { iv: string; tag: string; ciphertext: string }; // base64
}

@Controller('verify')
export class VerificationController {
  constructor(
    private readonly service: VerificationService,
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  @Post()
  async verify(@Body() body: VerifyBody, @Req() req: any) {
    const session = await this.sessions.findOne({ where: { sessionToken: body.session_token } });
    if (!session) throw new BadRequestException('invalid session_token');
    const tenant = await this.tenants.findOneOrFail({ where: { id: session.tenantId } });
    return this.service.verify({
      transactionId: randomUUID(),
      tenantId: tenant.id,
      rawIp: req.ip ?? '',
      webhookUrl: tenant.webhookUrl,
      webhookSecret: tenant.webhookSecret,
      encryptedFrame: {
        iv: Buffer.from(body.frame.iv, 'base64'),
        tag: Buffer.from(body.frame.tag, 'base64'),
        ciphertext: Buffer.from(body.frame.ciphertext, 'base64'),
      },
    });
  }
}
```

- [ ] **Step 2: Write `apps/api/src/verification/verification.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationSession } from '../session/session.entity';
import { Tenant } from '../tenant/tenant.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { MockAgeProvider } from './mock-age-provider';
import { loadDecisionConfig, encryptionKey } from '../config';

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
  ],
})
export class VerificationModule {}
```

- [ ] **Step 3: Update `apps/api/src/app.module.ts`**

Replace the file with:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant/tenant.entity';
import { VerificationSession } from './session/session.entity';
import { AuditLog } from './audit/audit-log.entity';
import { SessionModule } from './session/session.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Tenant, VerificationSession, AuditLog],
      synchronize: false,
    }),
    SessionModule,
    VerificationModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Build to verify wiring compiles**

Run: `npx tsc -b apps/api`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/verification.controller.ts apps/api/src/verification/verification.module.ts apps/api/src/app.module.ts
git commit -m "feat(verification): controller + module wiring"
```

---

## Task 15: Plugin — consent gate + payload builder (TDD)

**Files:**
- Create: `packages/plugin/package.json`, `packages/plugin/src/consent.ts`, `packages/plugin/src/payload.ts`
- Test: `packages/plugin/src/consent.spec.ts`, `packages/plugin/src/payload.spec.ts`

- [ ] **Step 1: Create `packages/plugin/package.json`**

```json
{
  "name": "@eca/plugin",
  "version": "0.0.1",
  "main": "src/index.ts"
}
```

- [ ] **Step 2: Write the failing payload test**

`packages/plugin/src/payload.spec.ts`
```ts
import { buildVerifyPayload } from './payload';

test('packs the encrypted frame as base64 with the session token', () => {
  const payload = buildVerifyPayload('sess-token', {
    iv: Buffer.from([1, 2, 3]),
    tag: Buffer.from([4, 5, 6]),
    ciphertext: Buffer.from([7, 8, 9]),
  });
  expect(payload).toEqual({
    session_token: 'sess-token',
    frame: {
      iv: Buffer.from([1, 2, 3]).toString('base64'),
      tag: Buffer.from([4, 5, 6]).toString('base64'),
      ciphertext: Buffer.from([7, 8, 9]).toString('base64'),
    },
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest payload`
Expected: FAIL — cannot find './payload'

- [ ] **Step 4: Write `packages/plugin/src/payload.ts`**

```ts
export interface RawEncryptedFrame {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function buildVerifyPayload(sessionToken: string, frame: RawEncryptedFrame) {
  return {
    session_token: sessionToken,
    frame: {
      iv: frame.iv.toString('base64'),
      tag: frame.tag.toString('base64'),
      ciphertext: frame.ciphertext.toString('base64'),
    },
  };
}
```

- [ ] **Step 5: Write the failing consent test**

`packages/plugin/src/consent.spec.ts`
```ts
import { canActivateCamera } from './consent';

test('camera is blocked until consent is given', () => {
  expect(canActivateCamera({ consentGiven: false })).toBe(false);
});

test('camera is allowed once consent is given', () => {
  expect(canActivateCamera({ consentGiven: true })).toBe(true);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest consent`
Expected: FAIL — cannot find './consent'

- [ ] **Step 7: Write `packages/plugin/src/consent.ts`**

```ts
export interface ConsentState {
  consentGiven: boolean;
}

/** The camera must never be activated before explicit consent (LGPD). */
export function canActivateCamera(state: ConsentState): boolean {
  return state.consentGiven === true;
}
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `npx jest payload consent`
Expected: PASS (3 tests total)

- [ ] **Step 9: Commit**

```bash
git add packages/plugin/package.json packages/plugin/src/consent.ts packages/plugin/src/payload.ts packages/plugin/src/consent.spec.ts packages/plugin/src/payload.spec.ts
git commit -m "feat(plugin): consent gate + verify payload builder"
```

---

## Task 16: Plugin — browser entry (consent UI + capture)

**Files:**
- Create: `packages/plugin/src/index.ts`, `packages/plugin/build.mjs`

> Camera/`getUserMedia` and WebCrypto are browser-only, so this file is not unit-tested; its logic is delegated to the already-tested `consent.ts` and `payload.ts`. Manual verification is in Task 17.

- [ ] **Step 1: Write `packages/plugin/src/index.ts`**

```ts
import { canActivateCamera, ConsentState } from './consent';
import { buildVerifyPayload } from './payload';

interface PluginOptions {
  sessionToken: string;
  apiBase: string;
  encryptionKeyHex: string; // ephemeral session key issued by tenant backend
  privacyPolicyUrl: string;
}

export async function mountEcaVerify(container: HTMLElement, opts: PluginOptions): Promise<void> {
  const state: ConsentState = { consentGiven: false };

  container.innerHTML = `
    <div class="eca-consent">
      <p>Para comprovar sua idade, capturaremos uma imagem do seu rosto, usada
         <strong>exclusivamente</strong> para verificação etária e descartada logo após.
         <a href="${opts.privacyPolicyUrl}" target="_blank" rel="noopener">Política de Privacidade</a>.</p>
      <label><input type="checkbox" id="eca-consent-box"/> Eu concordo com a captura biométrica para verificação de idade.</label>
      <button id="eca-start" disabled>Iniciar verificação</button>
    </div>`;

  const box = container.querySelector('#eca-consent-box') as HTMLInputElement;
  const btn = container.querySelector('#eca-start') as HTMLButtonElement;
  box.addEventListener('change', () => {
    state.consentGiven = box.checked;
    btn.disabled = !canActivateCamera(state);
  });

  btn.addEventListener('click', async () => {
    if (!canActivateCamera(state)) return;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    try {
      const frame = await captureFrame(stream);
      const enc = await encryptWithWebCrypto(frame, opts.encryptionKeyHex);
      const payload = buildVerifyPayload(opts.sessionToken, enc);
      await fetch(`${opts.apiBase}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      container.innerHTML = '<p>Verificação enviada.</p>';
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  });
}

async function captureFrame(stream: MediaStream): Promise<Uint8Array> {
  const video = document.createElement('video');
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

async function encryptWithWebCrypto(plain: Uint8Array, keyHex: string) {
  const keyBytes = Uint8Array.from(keyHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  // WebCrypto appends the 16-byte tag to the ciphertext; split it for the API contract.
  const tag = out.slice(out.length - 16);
  const ciphertext = out.slice(0, out.length - 16);
  return {
    iv: Buffer.from(iv),
    tag: Buffer.from(tag),
    ciphertext: Buffer.from(ciphertext),
  };
}
```

- [ ] **Step 2: Write `packages/plugin/build.mjs`**

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'EcaVerify',
  outfile: 'dist/eca-verify.js',
  minify: true,
  target: ['es2019'],
});
console.log('plugin bundled -> dist/eca-verify.js');
```

- [ ] **Step 3: Bundle to verify it compiles**

Run: `cd packages/plugin && npx esbuild --version >/dev/null && node build.mjs && cd ../..`
Expected: "plugin bundled -> dist/eca-verify.js"

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/index.ts packages/plugin/build.mjs
git commit -m "feat(plugin): browser entry with consent UI and capture"
```

---

## Task 17: End-to-end smoke test (manual)

**Files:**
- Create: `apps/api/test/smoke.http`

- [ ] **Step 1: Start Postgres and run migration + seed**

Run:
```bash
npx typeorm-ts-node-commonjs migration:run -d apps/api/src/db/data-source.ts
npx ts-node apps/api/scripts/seed-tenant.ts
```
Expected: migration ok; tenant id + `sk_...` API key printed. Note both.

- [ ] **Step 2: Start the API**

Run: `npx ts-node apps/api/src/main.ts`
Expected: Nest application listening on port 3000.

- [ ] **Step 3: Create a session (write `apps/api/test/smoke.http` and call it)**

`apps/api/test/smoke.http`
```
POST http://localhost:3000/sessions
Authorization: Bearer sk_REPLACE_WITH_SEEDED_KEY
Content-Type: application/json

{ "user_hash": "user_abc_123" }
```
Run with curl:
```bash
curl -s -X POST http://localhost:3000/sessions \
  -H "Authorization: Bearer sk_REPLACE_WITH_SEEDED_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_hash":"user_abc_123"}'
```
Expected: JSON with `session_token` and `plugin_url`. 200 OK.

- [ ] **Step 4: Verify the PII guard rejects bad payloads**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/sessions \
  -H "Authorization: Bearer sk_REPLACE_WITH_SEEDED_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_hash":"x","cpf":"00000000000"}'
```
Expected: `400`.

- [ ] **Step 5: Confirm audit row has no biometric data**

Run: `psql "$DATABASE_URL" -c "\\d audit_logs"`
Expected: columns are exactly `id, tenant_id, masked_ip, status, created_at` — no image/biometric column.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all suites pass (decision, crypto, signature, ip-mask, config, api-key.guard, pii-guard, webhook.service, audit.service, verification.service, mock-age-provider, sdk-types, payload, consent).

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/smoke.http
git commit -m "test: end-to-end smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** RF1 → Task 9; RF2 → Task 10; RF3 → Tasks 15-16; RF4 → Tasks 3,13; RF5 → Task 2; RF6 → Tasks 5,11; RF7 → Tasks 6,12. NFRs: efemeridade → Tasks 4,13 (`zero` in `finally`); schema sem biometria → Tasks 7,8,12 (asserted in test); minimização → Task 10; cripto → Tasks 4 (AES-256-GCM), 5 (HMAC), main.ts note (TLS at proxy).
- **Type consistency:** `VerificationStatus`, `AgeProviderResult`, `DecisionConfig`, `WebhookPayload`, `EncryptedFrame`, `AgeProviderPort.analyze`, `decideVerification`, `isOver18`, `signPayload`/`verifySignature`, `maskIp`, `assertNoPii`, `buildVerifyPayload`, `WebhookService.dispatch`, `AuditService.buildRecord/record`, `VerificationService.verify` — all names used consistently across tasks.
- **No placeholders:** every code step contains complete, runnable code.
```
