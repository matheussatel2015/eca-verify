# ECA Verify — Onda 3 / Plano 1: Trilha auditável do método + Artefato de prova assinado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Para sustentar o propósito legal (Lei 15.211/2025), registrar **como** cada idade foi confirmada (método, score, limiar, provedor, versão do modelo, motivo) numa tabela auditável sem biometria, e emitir um **artefato de prova de verificação assinado (JWT ES256)** que o tenant arquiva e qualquer auditor verifica com chave pública.

**Architecture:** Uma tabela `verification_records` (RLS FORCE, sem dado biométrico) guarda os metadados da decisão por transação. Funções puras montam os dados do registro e o "motivo" da decisão. `VerificationRecordService` persiste via `runScoped`. `ProofService` assina um JWT ES256 (lib `jose`) com a chave privada da plataforma e expõe a chave pública como JWK; o JWT é anexado ao webhook final e recuperável por `GET /verifications/:id/proof`, com JWKS público em `GET /.well-known/jwks.json`.

**Tech Stack:** Sobre o código existente (NestJS, TypeORM/Postgres, Jest). Adiciona `jose` (JWT/JWK, zero-dep). Reutiliza `runScoped`, `ApiKeyGuard`, os processors, `WebhookService`, `config.ts`.

> **Decisões:** assinatura **assimétrica ES256** (chave pública verifica, sem segredo compartilhado — defensável perante a ANPD); metadados em **nova tabela** `verification_records`; escopo deste plano = **trilha do método (item 2) + artefato de prova (item 3)**. Faixas de menores (item 4) e consentimento/erasure (item 5) são planos seguintes.
> **Sem biometria:** `verification_records` guarda apenas metadados de decisão (idade estimada, score, limiares, motivo) — NUNCA a imagem/biometria.
> **Chave de prova diferida:** `PROOF_PRIVATE_KEY` (PEM EC P-256) é gerada e injetada por ambiente; testes geram um par efêmero. Sem a chave, o boot falha apenas se a emissão de prova estiver ativada.

---

## File Structure

```
apps/api/src/
├── verification/
│   ├── verification-record.entity.ts     # NEW: verification_records (sem biometria)
│   ├── verification-record.service.ts    # NEW: persiste via runScoped (TDD)
│   ├── record-builder.ts                 # NEW: buildRecordData + explainDecision (puro, TDD)
│   ├── verification.service.ts           # MOD: monta+persiste record, assina proof, anexa ao payload
│   └── document/document.processor.ts    # MOD: idem para o fluxo documental
├── proof/
│   ├── proof.service.ts                  # NEW: assina JWT ES256 + publicJwk (TDD)
│   ├── proof.controller.ts               # NEW: GET /verifications/:id/proof + /.well-known/jwks.json
│   └── proof.module.ts                   # NEW
├── config.ts                             # MOD: loadProofKey + (validateEnv opcional)
├── db/migrations/0006-verification-records.ts  # NEW
packages/sdk-types/src/index.ts           # MOD: WebhookPayload.proof?
apps/api/test/proof-smoke.md              # NEW
```

---

## Task 1: `verification_records` entity + migration 0006

**Files:**
- Create: `apps/api/src/verification/verification-record.entity.ts`, `apps/api/src/db/migrations/0006-verification-records.ts`
- Modify: `apps/api/src/db/data-source.ts`, `apps/api/src/app.module.ts`

- [ ] **Step 1: Write the entity**

`apps/api/src/verification/verification-record.entity.ts`
```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

// NOTE: decision metadata only — NO biometric/image data ever.
@Entity('verification_records')
export class VerificationRecord {
  @PrimaryColumn('uuid') id!: string; // = transaction_id
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column() status!: string;
  @Column({ name: 'is_over_18' }) isOver18!: boolean;
  @Column() method!: string; // 'age_liveness' | 'document'
  @Column({ name: 'estimated_age', type: 'int', nullable: true }) estimatedAge!: number | null;
  @Column({ name: 'liveness_score', type: 'double precision', nullable: true }) livenessScore!: number | null;
  @Column({ name: 'cutoff_age', type: 'int' }) cutoffAge!: number;
  @Column({ type: 'int' }) margin!: number;
  @Column({ name: 'liveness_threshold', type: 'double precision' }) livenessThreshold!: number;
  @Column() provider!: string; // 'mock' | 'caf'
  @Column({ name: 'model_version' }) modelVersion!: string;
  @Column({ name: 'decision_reason' }) decisionReason!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
```

- [ ] **Step 2: Write `apps/api/src/db/migrations/0006-verification-records.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class VerificationRecords1717632000006 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE verification_records (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        status text NOT NULL,
        is_over_18 boolean NOT NULL,
        method text NOT NULL,
        estimated_age int,
        liveness_score double precision,
        cutoff_age int NOT NULL,
        margin int NOT NULL,
        liveness_threshold double precision NOT NULL,
        provider text NOT NULL,
        model_version text NOT NULL,
        decision_reason text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_vrec_tenant_created ON verification_records (tenant_id, created_at DESC)`);
    await q.query(`ALTER TABLE verification_records ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE verification_records FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY verification_records_isolation ON verification_records
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE verification_records`);
  }
}
```

- [ ] **Step 3: Register the entity** in `apps/api/src/db/data-source.ts` and `apps/api/src/app.module.ts` (add `VerificationRecord` to both `entities` arrays, with imports).

- [ ] **Step 4: Verify build**

Run: `npx tsc -b apps/api`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/verification-record.entity.ts apps/api/src/db/migrations/0006-verification-records.ts apps/api/src/db/data-source.ts apps/api/src/app.module.ts
git commit -m "feat(verification): verification_records table + RLS (migration 0006)"
```

---

## Task 2: Pure record-data + decision-reason builders

**Files:**
- Create: `apps/api/src/verification/record-builder.ts`
- Test: `apps/api/src/verification/record-builder.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/record-builder.spec.ts`
```ts
import { explainAgeDecision, buildAgeRecord } from './record-builder';
import { DecisionConfig } from '@eca/sdk-types';

const cfg: DecisionConfig = { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 };

test('explains a low-liveness rejection', () => {
  expect(explainAgeDecision({ estimatedAge: 40, livenessScore: 0.5 }, cfg, 'reprovado'))
    .toMatch(/liveness 0\.5 .* 0\.8/);
});

test('explains an approval by age margin', () => {
  expect(explainAgeDecision({ estimatedAge: 25, livenessScore: 0.9 }, cfg, 'aprovado'))
    .toMatch(/25 .* 21/); // cutoff+margin
});

test('explains a grey-zone document requirement', () => {
  expect(explainAgeDecision({ estimatedAge: 19, livenessScore: 0.9 }, cfg, 'documento_requerido'))
    .toMatch(/zona cinzenta|grey/i);
});

test('buildAgeRecord assembles persistable metadata without biometrics', () => {
  const rec = buildAgeRecord({
    transactionId: 'tx1', tenantId: 'ten1',
    result: { estimatedAge: 25, livenessScore: 0.9 }, cfg, status: 'aprovado',
    provider: 'mock', modelVersion: 'mock-1', now: new Date('2026-06-07T00:00:00Z'),
  });
  expect(rec).toMatchObject({
    id: 'tx1', tenantId: 'ten1', status: 'aprovado', isOver18: true, method: 'age_liveness',
    estimatedAge: 25, livenessScore: 0.9, cutoffAge: 18, margin: 3, livenessThreshold: 0.8,
    provider: 'mock', modelVersion: 'mock-1',
  });
  expect(typeof rec.decisionReason).toBe('string');
  expect(Object.keys(rec)).not.toContain('frame');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest record-builder`
Expected: FAIL — cannot find './record-builder'.

- [ ] **Step 3: Write `apps/api/src/verification/record-builder.ts`**

```ts
import { AgeProviderResult, DecisionConfig, VerificationStatus } from '@eca/sdk-types';
import { isOver18 } from './decision';

export function explainAgeDecision(result: AgeProviderResult, cfg: DecisionConfig, status: VerificationStatus): string {
  if (status === 'reprovado' && result.livenessScore < cfg.livenessThreshold) {
    return `liveness ${result.livenessScore} < limiar ${cfg.livenessThreshold}`;
  }
  if (status === 'aprovado') {
    return `idade estimada ${result.estimatedAge} >= corte ${cfg.cutoffAge} + margem ${cfg.margin} (${cfg.cutoffAge + cfg.margin})`;
  }
  if (status === 'reprovado') {
    return `idade estimada ${result.estimatedAge} < corte ${cfg.cutoffAge} - margem ${cfg.margin} (${cfg.cutoffAge - cfg.margin})`;
  }
  return `idade estimada ${result.estimatedAge} na zona cinzenta [${cfg.cutoffAge - cfg.margin}, ${cfg.cutoffAge + cfg.margin}) — documento requerido`;
}

export interface AgeRecordInput {
  transactionId: string;
  tenantId: string;
  result: AgeProviderResult;
  cfg: DecisionConfig;
  status: VerificationStatus;
  provider: string;
  modelVersion: string;
  now: Date;
}

export function buildAgeRecord(input: AgeRecordInput) {
  return {
    id: input.transactionId,
    tenantId: input.tenantId,
    status: input.status,
    isOver18: isOver18(input.status),
    method: 'age_liveness',
    estimatedAge: input.result.estimatedAge,
    livenessScore: input.result.livenessScore,
    cutoffAge: input.cfg.cutoffAge,
    margin: input.cfg.margin,
    livenessThreshold: input.cfg.livenessThreshold,
    provider: input.provider,
    modelVersion: input.modelVersion,
    decisionReason: explainAgeDecision(input.result, input.cfg, input.status),
    createdAt: input.now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest record-builder`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/record-builder.ts apps/api/src/verification/record-builder.spec.ts
git commit -m "feat(verification): pure record-data + decision-reason builders"
```

---

## Task 3: VerificationRecordService (RLS-scoped persist)

**Files:**
- Create: `apps/api/src/verification/verification-record.service.ts`
- Test: `apps/api/src/verification/verification-record.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/verification-record.service.spec.ts`
```ts
import { VerificationRecordService } from './verification-record.service';

test('saves a record scoped to the tenant (RLS) on the provided manager', async () => {
  const saved: any[] = [];
  const manager = { save: jest.fn(async (_e: any, row: any) => { saved.push(row); return row; }) };
  const svc = new VerificationRecordService();
  await svc.saveWith(manager as any, { id: 'tx1', tenantId: 'ten1', status: 'aprovado' } as any);
  expect(saved[0].id).toBe('tx1');
  expect(manager.save).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest verification-record.service`
Expected: FAIL — cannot find './verification-record.service'.

- [ ] **Step 3: Write `apps/api/src/verification/verification-record.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { VerificationRecord } from './verification-record.entity';

@Injectable()
export class VerificationRecordService {
  // Persists on the caller's RLS-scoped EntityManager (same connection that set app.tenant_id).
  async saveWith(manager: EntityManager, record: VerificationRecord): Promise<void> {
    await manager.save(VerificationRecord, record);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest verification-record.service`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/verification-record.service.ts apps/api/src/verification/verification-record.service.spec.ts
git commit -m "feat(verification): RLS-scoped verification record persistence"
```

---

## Task 4: `jose` dep + config proof key + ProofService

**Files:**
- Modify: `apps/api/package.json`, `apps/api/src/config.ts`, `.env.example`
- Create: `apps/api/src/proof/proof.service.ts`
- Test: `apps/api/src/proof/proof.service.spec.ts`

- [ ] **Step 1: Add `jose` to `apps/api/package.json` dependencies and install**

Add `"jose": "^5.9.6"` to `dependencies`, then run `npm install`.

- [ ] **Step 2: Add proof-key loading to `apps/api/src/config.ts`**

```ts
export function loadProofPrivateKeyPem(env: NodeJS.ProcessEnv): string | undefined {
  return env.PROOF_PRIVATE_KEY && env.PROOF_PRIVATE_KEY.trim() ? env.PROOF_PRIVATE_KEY : undefined;
}

export function proofIssuer(env: NodeJS.ProcessEnv): string {
  return env.PROOF_ISSUER ?? 'eca-verify';
}

export function modelVersion(env: NodeJS.ProcessEnv): string {
  return env.MODEL_VERSION ?? 'mock-1';
}
```
Append to `.env.example`:
```
PROOF_ISSUER=eca-verify
MODEL_VERSION=mock-1
# EC P-256 (prime256v1) private key in PKCS8 PEM. Generate:
#   openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt
PROOF_PRIVATE_KEY=
```

- [ ] **Step 3: Write the failing test**

`apps/api/src/proof/proof.service.spec.ts`
```ts
import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
import { ProofService } from './proof.service';

test('signs an ES256 JWT that verifies with the public JWK', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const pem = await exportPKCS8(privateKey);
  const svc = new ProofService(pem, 'eca-verify');

  const jwt = await svc.sign({ transaction_id: 'tx1', tenant_id: 'ten1', status: 'aprovado', is_over_18: true, method: 'age_liveness' });
  const jwk = await svc.publicJwk();
  expect(jwk.kty).toBe('EC');

  const { payload } = await jwtVerify(jwt, publicKey, { issuer: 'eca-verify' });
  expect(payload.transaction_id).toBe('tx1');
  expect(payload.is_over_18).toBe(true);
  expect(payload.iss).toBe('eca-verify');
});

test('throws if no private key is configured', () => {
  expect(() => new ProofService(undefined, 'eca-verify')).toThrow(/PROOF_PRIVATE_KEY/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest proof.service`
Expected: FAIL — cannot find './proof.service'.

- [ ] **Step 5: Write `apps/api/src/proof/proof.service.ts`**

```ts
import { importPKCS8, SignJWT, exportJWK, JWK } from 'jose';
import { createPublicKey } from 'crypto';

export interface ProofClaims {
  transaction_id: string;
  tenant_id: string;
  status: string;
  is_over_18: boolean;
  method: string;
}

export class ProofService {
  private readonly pem: string;
  constructor(privateKeyPem: string | undefined, private readonly issuer: string) {
    if (!privateKeyPem) throw new Error('PROOF_PRIVATE_KEY is required to issue verification proofs');
    this.pem = privateKeyPem;
  }

  async sign(claims: ProofClaims): Promise<string> {
    const key = await importPKCS8(this.pem, 'ES256');
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setSubject(claims.transaction_id)
      .sign(key);
  }

  async publicJwk(): Promise<JWK> {
    // Derive the public key from the configured private key (PEM → SPKI → JWK).
    const pub = createPublicKey({ key: this.pem, format: 'pem' });
    const jwk = await exportJWK(pub);
    return { ...jwk, alg: 'ES256', use: 'sig' };
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest proof.service`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/config.ts .env.example apps/api/src/proof/proof.service.ts apps/api/src/proof/proof.service.spec.ts
git commit -m "feat(proof): ES256 JWT proof service + config + jose dep"
```

---

## Task 5: Wire record + proof into the age/liveness path

**Files:**
- Modify: `packages/sdk-types/src/index.ts`, `apps/api/src/verification/verification.service.ts`, `apps/api/src/verification/verification.processor.ts`, `apps/api/src/verification/verification.module.ts`, `apps/api/src/worker.ts`

- [ ] **Step 1: Extend `WebhookPayload`** in `packages/sdk-types/src/index.ts` with an optional proof:
```ts
  proof?: string; // signed ES256 JWT verification receipt
```

- [ ] **Step 2: Extend `VerifyArgs` + `verify()` in `verification.service.ts`**

Add to the `VerifyArgs` interface:
```ts
  provider?: string;        // 'mock' | 'caf' — for the audit record
  modelVersion?: string;    // for the audit record
  recordManager?: import('typeorm').EntityManager; // RLS-scoped manager to persist the record
```
Inject `VerificationRecordService` and an optional `ProofService` into `VerificationService` (constructor). Note: `ProofService` may be absent if `PROOF_PRIVATE_KEY` is unset — accept `ProofService | null`.

In `verify()`, after computing `status`/`payload` and BEFORE `webhook.dispatch`:
```ts
      // Auditable method trail (no biometrics) — persisted on the RLS-scoped manager when provided.
      if (args.recordManager) {
        const record = buildAgeRecord({
          transactionId: args.transactionId, tenantId: args.tenantId,
          result: providerResult, cfg: this.cfg, status,
          provider: args.provider ?? 'mock', modelVersion: args.modelVersion ?? 'unknown', now: new Date(),
        });
        await this.records.saveWith(args.recordManager, record as any);
      }
      // Signed proof artifact for the tenant's evidence (if proof signing is configured).
      if (this.proof) {
        payload.proof = await this.proof.sign({
          transaction_id: args.transactionId, tenant_id: args.tenantId,
          status, is_over_18: payload.is_over_18, method: 'age_liveness',
        });
      }
```
Add imports for `buildAgeRecord`, `VerificationRecordService`, `ProofService`.

- [ ] **Step 3: Pass the scoped manager + provider/model from the processor**

In `apps/api/src/verification/verification.processor.ts`, the `runScoped(...)` callback already has `mgr`. Pass it plus provider/model into `service.verify`:
```ts
          recordManager: mgr,
          provider: process.env.AGE_PROVIDER_KIND ?? 'mock',
          modelVersion: process.env.MODEL_VERSION ?? 'mock-1',
```
(Do not change the processor constructor signature.)

- [ ] **Step 4: Wire providers in `verification.module.ts` and `worker.ts`**

In `verification.module.ts`: add `VerificationRecordService` to providers; construct `VerificationService` with the record service and a `ProofService` built from `loadProofPrivateKeyPem(process.env)` (pass `null` when unset — wrap construction so a missing key yields `null` rather than throwing at boot):
```ts
const proof = loadProofPrivateKeyPem(process.env) ? new ProofService(loadProofPrivateKeyPem(process.env), proofIssuer(process.env)) : null;
```
In `worker.ts`: do the same when constructing `VerificationService` for the worker (build a `VerificationRecordService` instance and the same optional `ProofService`, pass both).

- [ ] **Step 5: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green. (Update `verification.service.spec.ts`: the existing tests construct `VerificationService` with its old args — add the new `records` + `proof` constructor args, e.g. `new VerificationService(provider, audit, webhook, cfg, key, new VerificationRecordService(), null)`. With `proof=null` and no `recordManager` in the existing test args, the new branches are skipped, so assertions stay valid.)

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-types/src/index.ts apps/api/src/verification/verification.service.ts apps/api/src/verification/verification.service.spec.ts apps/api/src/verification/verification.processor.ts apps/api/src/verification/verification.module.ts apps/api/src/worker.ts
git commit -m "feat(verification): persist method trail + attach signed proof on age/liveness path"
```

---

## Task 6: Wire record + proof into the document path

**Files:**
- Modify: `apps/api/src/verification/document/document.processor.ts`, `apps/api/src/verification/document/document-record-builder.ts` (new) + test, `apps/api/src/worker.ts`

- [ ] **Step 1: Write the failing test for the document record builder**

`apps/api/src/verification/document/document-record-builder.spec.ts`
```ts
import { buildDocumentRecord } from './document-record-builder';

test('builds a document-method record without biometrics', () => {
  const rec = buildDocumentRecord({
    transactionId: 'tx2', tenantId: 'ten1', status: 'aprovado',
    ageFromDoc: 22, faceMatchScore: 0.95, cutoffAge: 18, provider: 'mock', modelVersion: 'mock-1',
    now: new Date('2026-06-07T00:00:00Z'),
  });
  expect(rec).toMatchObject({ id: 'tx2', tenantId: 'ten1', status: 'aprovado', isOver18: true, method: 'document', estimatedAge: 22, cutoffAge: 18, provider: 'mock' });
  expect(rec.decisionReason).toMatch(/documento|facematch|0\.95/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest document-record-builder`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `apps/api/src/verification/document/document-record-builder.ts`**

```ts
import { isOver18 } from '../decision';
import { VerificationStatus } from '@eca/sdk-types';

export interface DocRecordInput {
  transactionId: string;
  tenantId: string;
  status: VerificationStatus;
  ageFromDoc: number | null;
  faceMatchScore: number;
  cutoffAge: number;
  provider: string;
  modelVersion: string;
  now: Date;
}

export function buildDocumentRecord(i: DocRecordInput) {
  const reason = i.status === 'aprovado'
    ? `documento: idade ${i.ageFromDoc} >= corte ${i.cutoffAge}, facematch ${i.faceMatchScore}`
    : `documento reprovado (idade ${i.ageFromDoc}, facematch ${i.faceMatchScore}, corte ${i.cutoffAge})`;
  return {
    id: i.transactionId,
    tenantId: i.tenantId,
    status: i.status,
    isOver18: isOver18(i.status),
    method: 'document',
    estimatedAge: i.ageFromDoc,
    livenessScore: null,
    cutoffAge: i.cutoffAge,
    margin: 0,
    livenessThreshold: 0,
    provider: i.provider,
    modelVersion: i.modelVersion,
    decisionReason: reason,
    createdAt: i.now,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest document-record-builder`
Expected: PASS (1 test).

- [ ] **Step 5: Wire into `document.processor.ts`**

The `DocumentProcessor` already runs inside an RLS-scoped runner (`runScoped`) where it audits + dispatches the webhook. Inject `VerificationRecordService` and optional `ProofService` into its constructor (append as new params — and update `worker.ts` construction to pass them; do NOT reorder existing params). Inside the scoped block, after computing `status` and before/with the webhook dispatch:
```ts
      await this.records.saveWith(mgr, buildDocumentRecord({
        transactionId: job.transactionId, tenantId: job.tenantId, status,
        ageFromDoc, faceMatchScore: out.faceMatchScore, cutoffAge: this.cfg.cutoffAge,
        provider: process.env.DOC_VERIFIER_KIND ?? 'mock', modelVersion: process.env.MODEL_VERSION ?? 'mock-1',
        now: new Date(),
      }) as any);
      if (this.proof) {
        payload.proof = await this.proof.sign({ transaction_id: job.transactionId, tenant_id: job.tenantId, status, is_over_18: payload.is_over_18, method: 'document' });
      }
```
Update `document.processor.spec.ts`: pass a `new VerificationRecordService()` and `null` proof in the constructor; the record save uses the fake `mgr` (extend the fake's `manager` with a `save` jest.fn if needed); with `proof=null` the proof branch is skipped.

- [ ] **Step 6: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/verification/document/document-record-builder.ts apps/api/src/verification/document/document-record-builder.spec.ts apps/api/src/verification/document/document.processor.ts apps/api/src/verification/document/document.processor.spec.ts apps/api/src/worker.ts
git commit -m "feat(document): persist method trail + attach signed proof on document path"
```

---

## Task 7: Proof endpoints (retrieve receipt + JWKS)

**Files:**
- Create: `apps/api/src/proof/proof.controller.ts`, `apps/api/src/proof/proof.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/proof/proof.controller.ts`**

```ts
import { Controller, Get, NotFoundException, Param, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { runScoped } from '../tenant/tenant-scope';
import { VerificationRecord } from '../verification/verification-record.entity';
import { ProofService } from './proof.service';

@Controller()
export class ProofController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly proof: ProofService | null,
  ) {}

  // Public JWKS so anyone (tenant, auditor, ANPD) can verify a proof without a shared secret.
  @Get('.well-known/jwks.json')
  async jwks() {
    if (!this.proof) throw new ServiceUnavailableException('proof signing not configured');
    return { keys: [await this.proof.publicJwk()] };
  }

  // Re-issue the signed proof for one of the caller's own transactions (RLS-scoped).
  @Get('verifications/:id/proof')
  @UseGuards(ApiKeyGuard)
  async getProof(@Req() req: any, @Param('id') id: string) {
    if (!this.proof) throw new ServiceUnavailableException('proof signing not configured');
    const rec = await runScoped(this.dataSource, req.tenant.id, (mgr) =>
      mgr.findOne(VerificationRecord, { where: { id } }),
    );
    if (!rec) throw new NotFoundException('verification not found');
    const jwt = await this.proof.sign({
      transaction_id: rec.id, tenant_id: rec.tenantId, status: rec.status, is_over_18: rec.isOver18, method: rec.method,
    });
    return { transaction_id: rec.id, proof: jwt };
  }
}
```

- [ ] **Step 2: Write `apps/api/src/proof/proof.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import { loadProofPrivateKeyPem, proofIssuer } from '../config';

@Module({
  imports: [TenantModule], // ApiKeyGuard
  controllers: [ProofController],
  providers: [
    {
      provide: ProofService,
      useFactory: () => {
        const pem = loadProofPrivateKeyPem(process.env);
        return pem ? new ProofService(pem, proofIssuer(process.env)) : null;
      },
    },
  ],
})
export class ProofModule {}
```

- [ ] **Step 3: Register `ProofModule`** in `apps/api/src/app.module.ts` imports.

- [ ] **Step 4: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green. (NestJS injects `ProofService` which may be `null`; the `@Optional()`-style null is delivered by the factory returning null — if Nest rejects a null provider value, mark the controller's `ProofService` param with `@Optional()` from `@nestjs/common` and import it.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/proof/proof.controller.ts apps/api/src/proof/proof.module.ts apps/api/src/app.module.ts
git commit -m "feat(proof): JWKS + per-transaction proof retrieval endpoints"
```

---

## Task 8: Audit-proof smoke (manual)

**Files:**
- Create: `apps/api/test/proof-smoke.md`

- [ ] **Step 1: Write `apps/api/test/proof-smoke.md`**

````markdown
# Audit trail + proof smoke (requires infra + a PROOF_PRIVATE_KEY)

Generate a key and set it in .env:
```bash
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt
# put the PEM (one line with \n or multiline) into PROOF_PRIVATE_KEY
```

1. Run migrations (0001–0006), start API + workers, seed a tenant.
2. Run a verification (session → /verify with a mock provider). The final webhook payload now carries a `proof` JWT.
3. Fetch the public keys: `curl -s http://localhost:3000/.well-known/jwks.json` → one EC key (alg ES256).
4. Verify the `proof` JWT offline against that JWK (e.g. jwt.io or a `jose.jwtVerify`) → claims show transaction_id, status, is_over_18, method, iss=eca-verify.
5. `GET /verifications/<txid>/proof` with the tenant API key → re-issues the JWT for that transaction; another tenant's key → 404 (RLS isolation).
6. Inspect the method trail: `psql ... -c "SELECT method, estimated_age, liveness_score, cutoff_age, provider, model_version, decision_reason FROM verification_records LIMIT 5;"` → metadata present, NO biometric columns.
````

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest`
Expected: all suites green, including record-builder, verification-record.service, proof.service, document-record-builder.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/proof-smoke.md
git commit -m "test(proof): audit trail + proof smoke checklist"
```

---

## Self-Review Notes

- **Compliance coverage:** item 2 (trilha auditável do método) → `verification_records` + `record-builder`/`document-record-builder` + persistence on both paths (Tasks 1–3, 5, 6); item 3 (artefato de prova) → `ProofService` ES256 + proof in webhook + `GET /verifications/:id/proof` + public JWKS (Tasks 4, 5, 6, 7).
- **No biometrics:** `verification_records` has only decision metadata; the builders never receive image data; a test asserts the record has no `frame` key.
- **Tenant isolation:** the record table is `FORCE` RLS; writes use the processor's RLS-scoped `mgr`; the proof retrieval reads via `runScoped` + the API-key tenant → a tenant cannot fetch another's proof (returns 404).
- **Asymmetric, independently verifiable:** ES256 JWT signed with the platform private key; `/.well-known/jwks.json` exposes the public key so the tenant/auditor/ANPD verifies without any shared secret.
- **Type consistency:** `buildAgeRecord`/`buildDocumentRecord` output matches `VerificationRecord` columns; `ProofClaims` used by `sign` and both processors; `WebhookPayload.proof?` set by both paths and consumed by the tenant; `runScoped` (Onda 2) reused by the proof controller; `isOver18` reused from `decision.ts`.
- **Graceful when proof disabled:** if `PROOF_PRIVATE_KEY` is unset, `ProofService` is `null`, proof attachment is skipped, and the endpoints return 503 — the rest of the flow (and the method trail) still works.
- **No placeholders:** every code step is complete. `jose` is the one new dependency.
- **Deferred (needs infra/keys):** migration 0006 live-run; the smoke (Task 8) needs a `PROOF_PRIVATE_KEY`. All logic is unit-tested (proof via an in-test generated keypair; persistence via a fake manager).
- **Follow-ups (next Onda 3 plans):** item 4 (faixas <12/<16 + corte por tenant — will enrich the record's `method`/bands and the decision), item 5 (consent + erasure records), and the non-superuser DB role so RLS is a true backstop.
```
