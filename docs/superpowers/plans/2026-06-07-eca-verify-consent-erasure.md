# ECA Verify — Onda 3 / Plano 3: Registro de consentimento + prova de descarte/erasure (LGPD Art. 14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A LGPD (Art. 7º/8º/14º) exige base legal e **prova de consentimento** para o tratamento, e a política zero-storage da plataforma exige **prova de que a mídia efêmera foi destruída**. Este plano cria (a) uma tabela `consent_records` (sem biometria) capturada na abertura de sessão, com `policy_version` + consentimento explícito enviado pelo plugin; (b) um `discard_log` que registra a **deleção física** da mídia quando o processor faz `store.delete` no `finally`; e (c) um endpoint para o titular/auditor recuperar os registros de consentimento de um `user_hash`.

**Architecture:** Helpers **puros** (TDD) montam o `consent_record` e o `discard_event`. `POST /sessions` passa a exigir `policy_version` + `consent: true` (validados na borda) e persiste o `consent_record` na MESMA transação RLS-scoped que grava a sessão (reusa `withTenantScope`). Os processors (`VerificationProcessor`, `DocumentProcessor`) já deletam a mídia no `finally`; ali gravamos um `discard_event` via `runScoped` (`tx id`, tenant, `what='frame'|'document'`, `when`). Persistência sempre via os helpers de escopo existentes. Endpoint `GET /consent/:user_hash` (ApiKeyGuard + RLS) devolve os consentimentos do titular; nota sobre recuperação da prova de descarte por `transaction_id`.

**Tech Stack:** Sobre o código existente (NestJS, TypeORM/Postgres, Jest) + plugin JS Vanilla. Nenhuma dependência nova. Reutiliza `withTenantScope`/`runScoped`, `ApiKeyGuard`, o gate de consentimento existente do plugin (`canActivateCamera`), `assertNoPii`, e o padrão de migration RLS (0001/0003).

> **Decisões / assunções a CONFIRMAR (flagged):**
> - **`policy_version`** é uma string opaca controlada pelo tenant (ex.: `"2026-06-01"` ou semver). A plataforma só a registra; **não** valida conteúdo da política. **Confirmar** com jurídico o formato/governança de versionamento.
> - **`masked_ip`** reusa o `maskIp` já usado na auditoria (minimização de PII). O IP bruto **nunca** é persistido.
> - **Sem biometria:** `consent_records` e `discard_log` guardam **apenas** metadados (hash do usuário, versão da política, tx id, tipo de mídia, timestamps). Nenhuma imagem.
> - **Responsabilidade legal (out of scope):** a plataforma registra o **consentimento técnico do uso da câmera/verificação**. O **consentimento parental no sentido jurídico** (responsável legal de menor de 16) é **responsabilidade do TENANT** — este plano NÃO implementa coleta/validação de consentimento de responsável. Apenas oferece a trilha auditável do consentimento técnico e da prova de descarte.
> - **`discard_log`** é uma tabela NOVA (não estende `audit_logs`) para manter a auditoria de decisão separada da prova de erasure (cohesão; cada tabela com um propósito).

---

## File Structure

```
apps/api/src/
├── consent/
│   ├── consent-record.entity.ts          # NEW: consent_records (sem biometria)
│   ├── consent-record.builder.ts         # NEW: buildConsentRecord (puro, TDD)
│   ├── consent-record.builder.spec.ts    # NEW
│   ├── consent.service.ts                # NEW: persist (scoped) + list by user_hash (TDD)
│   ├── consent.service.spec.ts           # NEW
│   ├── consent.controller.ts             # NEW: GET /consent/:user_hash (ApiKeyGuard + RLS)
│   └── consent.module.ts                 # NEW
├── erasure/
│   ├── discard-event.entity.ts           # NEW: discard_log (prova de descarte)
│   ├── discard-event.builder.ts          # NEW: buildDiscardEvent (puro, TDD)
│   ├── discard-event.builder.spec.ts     # NEW
│   ├── discard.service.ts                # NEW: record discard (scoped) (TDD)
│   └── discard.service.spec.ts           # NEW
├── session/session.controller.ts         # MOD: exige policy_version + consent; grava consent_record
├── verification/verification.processor.ts# MOD: grava discard_event no finally (what='frame')
├── verification/document/document.processor.ts # MOD: grava discard_event no finally (what='document')
├── db/migrations/0008-consent-erasure.ts # NEW
├── app.module.ts                         # MOD: registra ConsentModule + entidades
├── worker.ts                             # MOD: injeta DiscardService nos processors
packages/plugin/src/payload.ts            # MOD: buildSessionOpenPayload(policy_version, consent)
packages/plugin/src/payload.spec.ts       # MOD
apps/api/test/consent-erasure-smoke.md    # NEW
```

---

## Task 1: Pure consent-record builder

**Files:**
- Create: `apps/api/src/consent/consent-record.builder.ts`, `apps/api/src/consent/consent-record.builder.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/consent/consent-record.builder.spec.ts`
```ts
import { buildConsentRecord } from './consent-record.builder';

test('builds a consent record with masked ip and no biometrics', () => {
  const rec = buildConsentRecord({
    id: 'c1', tenantId: 'ten1', userHash: 'uh_abc', policyVersion: '2026-06-01',
    scope: 'age_verification', rawIp: '203.0.113.45', now: new Date('2026-06-07T00:00:00Z'),
  });
  expect(rec).toMatchObject({
    id: 'c1', tenantId: 'ten1', userHash: 'uh_abc', policyVersion: '2026-06-01', scope: 'age_verification',
  });
  expect(rec.maskedIp).toMatch(/203\.0\.113\.0|203\.0\.113\.x|\*/); // masked, not the raw last octet
  expect(rec.maskedIp).not.toBe('203.0.113.45');
  expect(Object.keys(rec)).not.toContain('frame');
  expect(rec.createdAt).toBeInstanceOf(Date);
});

test('defaults the scope to age_verification', () => {
  const rec = buildConsentRecord({
    id: 'c2', tenantId: 'ten1', userHash: 'uh', policyVersion: 'v1', rawIp: '1.2.3.4', now: new Date(),
  });
  expect(rec.scope).toBe('age_verification');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest consent-record.builder`
Expected: FAIL — cannot find './consent-record.builder'.

- [ ] **Step 3: Write `apps/api/src/consent/consent-record.builder.ts`**

```ts
import { maskIp } from '../audit/ip-mask.util';

export interface ConsentRecordInput {
  id: string;
  tenantId: string;
  userHash: string;
  policyVersion: string;
  scope?: string;
  rawIp: string;
  now: Date;
}

// Metadata only — NEVER any biometric/image data.
export function buildConsentRecord(input: ConsentRecordInput) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    userHash: input.userHash,
    policyVersion: input.policyVersion,
    scope: input.scope ?? 'age_verification',
    maskedIp: maskIp(input.rawIp),
    createdAt: input.now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest consent-record.builder`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/consent/consent-record.builder.ts apps/api/src/consent/consent-record.builder.spec.ts
git commit -m "feat(consent): pure consent-record builder (masked ip, no biometrics)"
```

---

## Task 2: Pure discard-event builder

**Files:**
- Create: `apps/api/src/erasure/discard-event.builder.ts`, `apps/api/src/erasure/discard-event.builder.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/erasure/discard-event.builder.spec.ts`
```ts
import { buildDiscardEvent, DISCARD_KINDS } from './discard-event.builder';

test('builds a frame discard event', () => {
  const ev = buildDiscardEvent({ transactionId: 'tx1', tenantId: 'ten1', what: 'frame', now: new Date('2026-06-07T00:00:00Z') });
  expect(ev).toMatchObject({ id: expect.any(String), transactionId: 'tx1', tenantId: 'ten1', what: 'frame' });
  expect(ev.discardedAt).toBeInstanceOf(Date);
  expect(Object.keys(ev)).not.toContain('frame'); // proof of deletion, never the media
});

test('builds a document discard event', () => {
  const ev = buildDiscardEvent({ transactionId: 'tx2', tenantId: 'ten1', what: 'document', now: new Date() });
  expect(ev.what).toBe('document');
});

test('rejects an unknown media kind', () => {
  expect(() => buildDiscardEvent({ transactionId: 'tx3', tenantId: 'ten1', what: 'selfie' as any, now: new Date() }))
    .toThrow(/what/);
  expect(DISCARD_KINDS).toEqual(['frame', 'document']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest discard-event.builder`
Expected: FAIL — cannot find './discard-event.builder'.

- [ ] **Step 3: Write `apps/api/src/erasure/discard-event.builder.ts`**

```ts
import { randomUUID } from 'crypto';

export const DISCARD_KINDS = ['frame', 'document'] as const;
export type DiscardKind = typeof DISCARD_KINDS[number];

export interface DiscardEventInput {
  transactionId: string;
  tenantId: string;
  what: DiscardKind;
  now: Date;
}

// Proof that the ephemeral media was physically deleted — metadata only.
export function buildDiscardEvent(input: DiscardEventInput) {
  if (!(DISCARD_KINDS as readonly string[]).includes(input.what)) {
    throw new Error(`what must be one of ${DISCARD_KINDS.join(', ')}`);
  }
  return {
    id: randomUUID(),
    transactionId: input.transactionId,
    tenantId: input.tenantId,
    what: input.what,
    discardedAt: input.now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest discard-event.builder`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/erasure/discard-event.builder.ts apps/api/src/erasure/discard-event.builder.spec.ts
git commit -m "feat(erasure): pure discard-event builder (frame|document, no media)"
```

---

## Task 3: Entities + migration 0008 (consent_records + discard_log, RLS FORCE)

**Files:**
- Create: `apps/api/src/consent/consent-record.entity.ts`, `apps/api/src/erasure/discard-event.entity.ts`, `apps/api/src/db/migrations/0008-consent-erasure.ts`
- Modify: `apps/api/src/db/data-source.ts`, `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/consent/consent-record.entity.ts`**

```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

// NOTE: consent metadata only — NO biometric/image data ever.
@Entity('consent_records')
export class ConsentRecord {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'user_hash' }) userHash!: string;
  @Column({ name: 'policy_version' }) policyVersion!: string;
  @Column() scope!: string; // e.g. 'age_verification'
  @Column({ name: 'masked_ip' }) maskedIp!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
```

- [ ] **Step 2: Write `apps/api/src/erasure/discard-event.entity.ts`**

```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

// NOTE: proof of physical deletion — NO biometric/image data ever.
@Entity('discard_log')
export class DiscardEvent {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'transaction_id', type: 'uuid' }) transactionId!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column() what!: string; // 'frame' | 'document'
  @Column({ name: 'discarded_at', type: 'timestamptz' }) discardedAt!: Date;
}
```

- [ ] **Step 3: Write `apps/api/src/db/migrations/0008-consent-erasure.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConsentErasure1717632000008 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE consent_records (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_hash text NOT NULL,
        policy_version text NOT NULL,
        scope text NOT NULL DEFAULT 'age_verification',
        masked_ip text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_consent_tenant_user ON consent_records (tenant_id, user_hash, created_at DESC)`);

    await q.query(`
      CREATE TABLE discard_log (
        id uuid PRIMARY KEY,
        transaction_id uuid NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        what text NOT NULL,
        discarded_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_discard_tenant_tx ON discard_log (tenant_id, transaction_id)`);

    // Row-Level Security FORCE on both tables — same pattern as 0001.
    for (const t of ['consent_records', 'discard_log']) {
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY ${t}_isolation ON ${t}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS discard_log`);
    await q.query(`DROP TABLE IF EXISTS consent_records`);
  }
}
```

- [ ] **Step 4: Register the entities** in `apps/api/src/db/data-source.ts` and `apps/api/src/app.module.ts` (add `ConsentRecord` and `DiscardEvent` to both `entities` arrays, with imports).

- [ ] **Step 5: Verify build**

Run: `npx tsc -b apps/api`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/consent/consent-record.entity.ts apps/api/src/erasure/discard-event.entity.ts apps/api/src/db/migrations/0008-consent-erasure.ts apps/api/src/db/data-source.ts apps/api/src/app.module.ts
git commit -m "feat(consent,erasure): consent_records + discard_log tables + RLS (migration 0008)"
```

---

## Task 4: ConsentService (persist scoped + list by user_hash)

**Files:**
- Create: `apps/api/src/consent/consent.service.ts`, `apps/api/src/consent/consent.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/consent/consent.service.spec.ts`
```ts
import { ConsentService } from './consent.service';

test('saveWith persists the consent record on the provided RLS-scoped manager', async () => {
  const saved: any[] = [];
  const manager = { save: jest.fn(async (_e: any, row: any) => { saved.push(row); return row; }) };
  const dataSource: any = {}; // unused on this path
  const svc = new ConsentService(dataSource);
  await svc.saveWith(manager as any, { id: 'c1', tenantId: 'ten1', userHash: 'uh', policyVersion: 'v1', scope: 'age_verification', maskedIp: '1.2.3.0', createdAt: new Date() } as any);
  expect(saved[0].id).toBe('c1');
  expect(manager.save).toHaveBeenCalledTimes(1);
});

test('listByUserHash reads scoped to the tenant', async () => {
  const rows = [{ id: 'c1', userHash: 'uh', policyVersion: 'v1' }];
  const manager = { find: jest.fn(async () => rows) };
  const dataSource: any = {
    createQueryRunner: () => ({ connect: jest.fn(), query: jest.fn(), release: jest.fn(), manager }),
  };
  const svc = new ConsentService(dataSource);
  const out = await svc.listByUserHash('ten1', 'uh');
  expect(out).toEqual(rows);
  expect(manager.find).toHaveBeenCalledWith(expect.anything(), { where: { userHash: 'uh' }, order: { createdAt: 'DESC' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest consent.service`
Expected: FAIL — cannot find './consent.service'.

- [ ] **Step 3: Write `apps/api/src/consent/consent.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConsentRecord } from './consent-record.entity';
import { runScoped } from '../tenant/tenant-scope';

@Injectable()
export class ConsentService {
  constructor(private readonly dataSource: DataSource) {}

  // Persists on the caller's RLS-scoped manager (same connection/tx that set app.tenant_id).
  async saveWith(manager: EntityManager, record: ConsentRecord): Promise<void> {
    await manager.save(ConsentRecord, record);
  }

  // Data-subject access: list this tenant's consent records for one user_hash (RLS-scoped).
  async listByUserHash(tenantId: string, userHash: string): Promise<ConsentRecord[]> {
    return runScoped(this.dataSource, tenantId, (mgr) =>
      mgr.find(ConsentRecord, { where: { userHash }, order: { createdAt: 'DESC' } }),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest consent.service`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/consent/consent.service.ts apps/api/src/consent/consent.service.spec.ts
git commit -m "feat(consent): RLS-scoped persist + list-by-user_hash service"
```

---

## Task 5: DiscardService (record discard scoped)

**Files:**
- Create: `apps/api/src/erasure/discard.service.ts`, `apps/api/src/erasure/discard.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/erasure/discard.service.spec.ts`
```ts
import { DiscardService } from './discard.service';

test('records a discard event scoped to the tenant', async () => {
  const saved: any[] = [];
  const manager = { save: jest.fn(async (_e: any, row: any) => { saved.push(row); return row; }) };
  const dataSource: any = {
    createQueryRunner: () => ({ connect: jest.fn(), query: jest.fn(), release: jest.fn(), manager }),
  };
  const svc = new DiscardService(dataSource);
  await svc.record({ transactionId: 'tx1', tenantId: 'ten1', what: 'frame', now: new Date('2026-06-07T00:00:00Z') });
  expect(saved[0]).toMatchObject({ transactionId: 'tx1', tenantId: 'ten1', what: 'frame' });
  expect(manager.save).toHaveBeenCalledTimes(1);
});

test('never throws into the caller (best-effort erasure proof)', async () => {
  const dataSource: any = { createQueryRunner: () => { throw new Error('db down'); } };
  const svc = new DiscardService(dataSource);
  await expect(svc.record({ transactionId: 'tx2', tenantId: 'ten1', what: 'document', now: new Date() })).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest discard.service`
Expected: FAIL — cannot find './discard.service'.

- [ ] **Step 3: Write `apps/api/src/erasure/discard.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DiscardEvent } from './discard-event.entity';
import { buildDiscardEvent, DiscardEventInput } from './discard-event.builder';
import { runScoped } from '../tenant/tenant-scope';

@Injectable()
export class DiscardService {
  private readonly logger = new Logger(DiscardService.name);
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Best-effort proof that the ephemeral media was deleted. Runs in the processor's
   * `finally`; it must NEVER throw, because the physical delete already happened and
   * a logging failure must not mask the success or re-trigger work.
   */
  async record(input: DiscardEventInput): Promise<void> {
    try {
      const event = buildDiscardEvent(input);
      await runScoped(this.dataSource, input.tenantId, (mgr) => mgr.save(DiscardEvent, event));
    } catch (e) {
      this.logger.warn(`failed to write discard proof for ${input.transactionId}: ${(e as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest discard.service`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/erasure/discard.service.ts apps/api/src/erasure/discard.service.spec.ts
git commit -m "feat(erasure): best-effort RLS-scoped discard-proof service"
```

---

## Task 6: Plugin sends policy_version + consent on session open

**Files:**
- Modify: `packages/plugin/src/payload.ts`, `packages/plugin/src/payload.spec.ts`, `packages/plugin/src/index.ts`

> The plugin already gates the camera on explicit consent (`canActivateCamera`). This task makes the session-open call carry the same consent decision + the policy version so the backend can persist the proof.

- [ ] **Step 1: Write the failing test**

Add to `packages/plugin/src/payload.spec.ts`:
```ts
import { buildSessionOpenPayload } from './payload';

test('session-open payload carries user_hash, policy_version and explicit consent', () => {
  const p = buildSessionOpenPayload({ userHash: 'uh_abc', policyVersion: '2026-06-01', consentGiven: true });
  expect(p).toEqual({ user_hash: 'uh_abc', policy_version: '2026-06-01', consent: true });
});

test('session-open payload reflects a refused consent', () => {
  const p = buildSessionOpenPayload({ userHash: 'uh', policyVersion: 'v1', consentGiven: false });
  expect(p.consent).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest payload` (from the plugin package, or root jest if configured)
Expected: FAIL — `buildSessionOpenPayload` is not exported.

- [ ] **Step 3: Add `buildSessionOpenPayload` to `packages/plugin/src/payload.ts`**

```ts
export interface SessionOpenInput {
  userHash: string;
  policyVersion: string;
  consentGiven: boolean;
}

// Sent by the tenant backend (or plugin bootstrap) to POST /sessions.
export function buildSessionOpenPayload(input: SessionOpenInput) {
  return {
    user_hash: input.userHash,
    policy_version: input.policyVersion,
    consent: input.consentGiven === true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest payload`
Expected: PASS.

- [ ] **Step 5: Thread `policyVersion` through the plugin bootstrap**

In `packages/plugin/src/index.ts`, add `policyVersion: string` to `PluginOptions` and reuse the consent state when building the session-open payload (where the plugin/host opens the session). The existing camera gate (`canActivateCamera`) is the source of truth for `consentGiven`; reuse it — do NOT add a second consent toggle. Minimal change:
```ts
interface PluginOptions {
  sessionToken: string;
  apiBase: string;
  encryptionKeyHex: string;
  privacyPolicyUrl: string;
  policyVersion: string; // version of the privacy policy shown to the user
}
```
> NOTE: in the current MVP the session is opened server-side by the tenant before the plugin mounts; `buildSessionOpenPayload` is the contract the tenant's backend uses for `POST /sessions`. The plugin change documents `policyVersion` in options so the same value flows to the backend. No camera/capture logic changes.

- [ ] **Step 6: Verify build + suite**

Run: `npx jest payload && npx tsc -b packages/plugin`
Expected: PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/payload.ts packages/plugin/src/payload.spec.ts packages/plugin/src/index.ts
git commit -m "feat(plugin): session-open payload carries policy_version + explicit consent"
```

---

## Task 7: `POST /sessions` validates consent + persists the consent record

**Files:**
- Modify: `apps/api/src/session/session.controller.ts`, `apps/api/src/session/session.module.ts` (provider import)

> Persists the consent record in the SAME RLS-scoped transaction that saves the session (`withTenantScope`), so the two cannot diverge.

- [ ] **Step 1: Update `apps/api/src/session/session.controller.ts`**

Add imports:
```ts
import { randomUUID, randomBytes } from 'crypto';
import { buildConsentRecord } from '../consent/consent-record.builder';
import { ConsentService } from '../consent/consent.service';
```
Inject `ConsentService` (append to the constructor — do NOT reorder):
```ts
  constructor(
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
    private readonly billing: BillingService,
    private readonly consent: ConsentService,
  ) {}
```
In `create()`, after validating `user_hash`, validate the consent fields and capture the masked IP:
```ts
    const policyVersion = body['policy_version'];
    if (typeof policyVersion !== 'string' || !policyVersion.trim()) {
      throw new BadRequestException('policy_version is required');
    }
    if (body['consent'] !== true) {
      throw new BadRequestException('explicit consent is required to open a verification session');
    }
```
Then persist BOTH rows in the same scoped transaction (replace the existing `transaction(...)` block):
```ts
    const rawIp = (req.ip as string) ?? (req.headers?.['x-forwarded-for'] as string) ?? '0.0.0.0';
    const consentRecord = buildConsentRecord({
      id: randomUUID(), tenantId, userHash, policyVersion, scope: 'age_verification', rawIp, now: new Date(),
    });
    await this.sessions.manager.transaction(async (mgr) => {
      await withTenantScope({ query: (sql, params) => mgr.query(sql, params) }, tenantId, async () => {
        await mgr.save(VerificationSession, session);
        await this.consent.saveWith(mgr, consentRecord as any);
      });
    });
```

- [ ] **Step 2: Provide `ConsentService` to the session module**

In `apps/api/src/session/session.module.ts`, import `ConsentModule` (which exports `ConsentService`) OR add `ConsentService` to providers (it depends only on `DataSource`). Prefer importing `ConsentModule` to keep one owner.

- [ ] **Step 3: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest session`
Expected: tsc clean; update `session.controller.spec.ts` — existing tests must now pass `policy_version` + `consent: true` in the body and provide a fake `ConsentService` (`{ saveWith: jest.fn() }`) to the controller; add explicit cases for missing `policy_version` (400) and `consent !== true` (400).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/session/session.controller.ts apps/api/src/session/session.controller.spec.ts apps/api/src/session/session.module.ts
git commit -m "feat(session): require + persist explicit consent on session open (RLS tx)"
```

---

## Task 8: Wire discard proof into both processors

**Files:**
- Modify: `apps/api/src/verification/verification.processor.ts`, `apps/api/src/verification/document/document.processor.ts`, `apps/api/src/worker.ts`, the two processor spec files

- [ ] **Step 1: Inject `DiscardService` (optional) into `VerificationProcessor`**

Append a constructor param (do NOT reorder existing ones):
```ts
    private readonly discard?: import('../erasure/discard.service').DiscardService,
```
In the `finally`, after `await this.store.delete(job.frameRef)`:
```ts
      // Erasure proof: record that the temporary media was physically deleted.
      await this.discard?.record({ transactionId: job.transactionId, tenantId: job.tenantId, what: 'frame', now: new Date() });
```
(`DiscardService.record` is best-effort and never throws, so it cannot break the cleanup path.)

- [ ] **Step 2: Inject `DiscardService` (optional) into `DocumentProcessor`**

Append a constructor param (after the existing trailing `onceTtlMs`):
```ts
    private readonly discard?: import('../../erasure/discard.service').DiscardService,
```
In the `finally`, after the two `store.delete` calls:
```ts
      await this.discard?.record({ transactionId: job.transactionId, tenantId: job.tenantId, what: 'document', now: new Date() });
```

- [ ] **Step 3: Construct `DiscardService` in `worker.ts` and pass it to both processors**

In `apps/api/src/worker.ts`, after `AppDataSource.initialize()`:
```ts
  const { DiscardService } = await import('./erasure/discard.service');
  const discard = new DiscardService(AppDataSource);
```
Pass `discard` as the last arg of both `new VerificationProcessor(...)` and `new DocumentProcessor(...)`. (Static import at top is equally fine; the dynamic import just keeps the diff local.)

- [ ] **Step 4: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all green. The processor specs construct the processors WITHOUT the new param, so `this.discard` is `undefined` and the `?.record` call is skipped — existing tests stay valid. ADD one test per processor that passes a fake `{ record: jest.fn() }` and asserts it was called once with `what: 'frame'` / `what: 'document'` after a successful run.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/verification.processor.ts apps/api/src/verification/verification.processor.spec.ts apps/api/src/verification/document/document.processor.ts apps/api/src/verification/document/document.processor.spec.ts apps/api/src/worker.ts
git commit -m "feat(erasure): record discard proof when processors delete media"
```

---

## Task 9: Data-subject consent endpoint + module

**Files:**
- Create: `apps/api/src/consent/consent.controller.ts`, `apps/api/src/consent/consent.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/consent/consent.controller.ts`**

```ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { ConsentService } from './consent.service';

@Controller('consent')
@UseGuards(ApiKeyGuard)
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  // Data-subject access: the tenant retrieves the consent trail for one of ITS users.
  // RLS scopes the read; a tenant can never see another tenant's consent records.
  @Get(':user_hash')
  async byUser(@Req() req: any, @Param('user_hash') userHash: string) {
    const records = await this.consent.listByUserHash(req.tenant.id, userHash);
    return {
      user_hash: userHash,
      consents: records.map((r) => ({
        id: r.id,
        policy_version: r.policyVersion,
        scope: r.scope,
        masked_ip: r.maskedIp,
        created_at: r.createdAt,
      })),
      // Erasure proof is keyed by transaction_id (see discard_log); retrieve per-transaction
      // via the audit/erasure trail. Kept separate so consent and deletion proofs stay distinct.
      erasure_proof_note: 'discard_log holds physical-deletion events per transaction_id (RLS-scoped)',
    };
  }
}
```

- [ ] **Step 2: Write `apps/api/src/consent/consent.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';

@Module({
  imports: [TenantModule], // ApiKeyGuard
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService], // consumed by SessionModule
})
export class ConsentModule {}
```

- [ ] **Step 3: Register `ConsentModule`** in `apps/api/src/app.module.ts` imports (and ensure `SessionModule` imports `ConsentModule` per Task 7 Step 2).

- [ ] **Step 4: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/consent/consent.controller.ts apps/api/src/consent/consent.module.ts apps/api/src/app.module.ts
git commit -m "feat(consent): GET /consent/:user_hash data-subject endpoint (ApiKeyGuard + RLS)"
```

---

## Task 10: Consent + erasure smoke (manual)

**Files:**
- Create: `apps/api/test/consent-erasure-smoke.md`

- [ ] **Step 1: Write `apps/api/test/consent-erasure-smoke.md`**

````markdown
# Consent + erasure-proof smoke (requires infra)

1. Run migrations (0001–0008), start API + workers, seed a tenant.
2. Open a session WITH consent:
   `curl -X POST -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" \
     -d '{"user_hash":"uh_abc","policy_version":"2026-06-01","consent":true}' http://localhost:3000/sessions`
   → 200 with `session_token` + `plugin_url`.
3. Missing consent: `-d '{"user_hash":"uh","policy_version":"v1"}'` → 400; `consent:false` → 400; missing `policy_version` → 400.
4. PII still barred: a body with `cpf`/`email` → 400 (assertNoPii unchanged).
5. Run a verification through to completion (frame or document path). The processor deletes the media in `finally`.
6. Erasure proof: `psql ... -c "SELECT transaction_id, what, discarded_at FROM discard_log ORDER BY discarded_at DESC LIMIT 5;"`
   → one row per completed tx (`what` = `frame` or `document`), NO media columns.
7. Consent retrieval: `curl -H "Authorization: Bearer <api-key>" http://localhost:3000/consent/uh_abc`
   → JSON with `consents[]` (policy_version, scope, masked_ip, created_at) + the erasure_proof_note.
8. Cross-tenant isolation: a second tenant's key on `/consent/uh_abc` → empty `consents[]` (RLS), never the first tenant's rows.
9. No biometrics: inspect both tables — only metadata columns, never an image.

> LEGAL: the platform records the TECHNICAL consent (camera/verification) + the deletion proof.
> Parental consent in the legal sense (responsável legal de menor de 16) is the TENANT's responsibility — out of scope here.
````

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest`
Expected: all suites green, including consent-record.builder, discard-event.builder, consent.service, discard.service, payload (session-open), and the new processor discard tests.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/consent-erasure-smoke.md
git commit -m "test(consent,erasure): consent + erasure-proof smoke checklist"
```

---

## Self-Review Notes

- **Compliance coverage (item 5):** registro de consentimento (LGPD Art. 14) → `consent_records` + `buildConsentRecord` + captura em `POST /sessions` na mesma transação RLS (Tasks 1, 3, 4, 7); prova de descarte/erasure → `discard_log` + `buildDiscardEvent` + `DiscardService.record` no `finally` de ambos os processors (Tasks 2, 3, 5, 8); acesso do titular → `GET /consent/:user_hash` (Task 9).
- **Sem biometria:** `consent_records` e `discard_log` só têm metadados; os builders nunca recebem imagem; testes asseguram ausência de chave `frame`.
- **Tenant isolation:** ambas as tabelas são `FORCE` RLS (padrão 0001); o consent é gravado na transação `withTenantScope` da sessão; o discard via `runScoped`; a leitura do titular via `runScoped` + `ApiKeyGuard` → um tenant nunca vê consentimentos/descarte de outro.
- **Consentimento explícito na borda:** `POST /sessions` exige `policy_version` + `consent === true`; o plugin reusa o gate existente (`canActivateCamera`) — não há segundo toggle; `buildSessionOpenPayload` é o contrato.
- **Erasure é best-effort e não-bloqueante:** `DiscardService.record` nunca lança (a deleção física já ocorreu; um erro de log não pode mascarar o sucesso nem re-disparar o job); chamado com `?.` para que processors construídos sem o serviço (testes/MVP) sigam funcionando.
- **Type consistency:** builders puros alimentam entidades de colunas idênticas; `DiscardKind` (`'frame'|'document'`) compartilhado builder↔processors; `ConsentService.saveWith` usa o `mgr` da transação da sessão; `runScoped`/`withTenantScope` (Onda 2) reusados; `maskIp` (auditoria) reusado.
- **Reuso de padrões:** migration RLS no estilo 0001/0003; `ApiKeyGuard`; `assertNoPii` intacto na borda da sessão; nenhuma dependência nova.
- **No placeholders:** todo passo tem código completo.
- **Deferred (needs infra):** migration 0008 live-run e o smoke (Task 10). Toda a lógica é unit-testada (builders puros; services via fake DataSource/manager; payload do plugin).
- **ASSUNÇÕES FLAGGED P/ O USUÁRIO / JURÍDICO:** (1) **consentimento parental no sentido legal (responsável de menor de 16) é responsabilidade do TENANT** — out of scope; a plataforma só registra o consentimento TÉCNICO + a prova de descarte; (2) `policy_version` é string opaca controlada pelo tenant — **confirmar** governança/formato; (3) `discard_log` separado de `audit_logs` por coesão — confirmar se a fiscalização prefere uma trilha unificada.
- **Follow-ups:** endpoint dedicado de recuperação da prova de descarte por `transaction_id` (hoje via SQL/erasure trail); retenção/expiração dos `consent_records` conforme política; o role não-superusuário do DB (backstop real do RLS) segue como item transversal das próximas ondas.
