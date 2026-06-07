# ECA Verify — Onda 3 / Plano 2: Faixas de menores (<12/<16) + corte etário por tenant

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Lei 15.211/2025 trata menores em faixas distintas (proteção reforçada para crianças e adolescentes mais novos). Para sustentar isso, classificar a idade estimada/confirmada numa **faixa etária** (`crianca` <12, `adolescente_jovem` 12–15, `adolescente` 16–17, `adulto` 18+) e permitir que **cada tenant configure seu próprio corte de idade** (`required_age`), em vez do corte global fixo no `.env`. A faixa alimenta a trilha auditável (`verification_records` do Plano 1) e, opcionalmente, o webhook.

**Architecture:** Um classificador **puro** (`age-band.ts`, TDD) mapeia idade → faixa, sem tocar em `decideVerification` (cuja assinatura permanece intacta — apenas ADICIONAMOS um helper de faixa). A coluna `required_age` (int, default 18) entra na tabela `tenants` (migration **0007**) e na entidade `Tenant`. O corte por-tenant é **threaded** até onde hoje se usa `cfg.cutoffAge`: o processor lê `tenant.requiredAge` e monta um `DecisionConfig` efetivo (`{ ...cfg, cutoffAge: tenant.requiredAge ?? cfg.cutoffAge }`) — o `cfg` global continua sendo o fallback. A faixa é exposta no record (`age_band`) e, como campo opcional, no `WebhookPayload`. Um endpoint pequeno (`GET/PUT /tenants/me/settings`) deixa o tenant ler/ajustar seu `required_age`, sob `ApiKeyGuard` + RLS.

**Tech Stack:** Sobre o código existente (NestJS, TypeORM/Postgres, Jest) e sobre o Plano 1 (`verification_records`, `record-builder`). Nenhuma dependência nova. Reutiliza `runScoped`, `withTenantScope`, `ApiKeyGuard`, extensão de `WebhookPayload`, padrão de migration RLS (0001/0004) e a regra "sem biometria".

> **Decisões / assunções a CONFIRMAR COM JURÍDICO (flagged):**
> - **Limiares de faixa** `crianca` (<12), `adolescente_jovem` (12–15), `adolescente` (16–17), `adulto` (18+) são **defaults sensatos** alinhados ao ECA (12 e 16 são marcos clássicos), mas **NÃO são imposição literal da Lei 15.211/2025** — **confirmar com jurídico** antes de produção. Estão centralizados em constantes nomeadas para troca trivial.
> - **`required_age` default 18.** Cada tenant pode endurecer (ex.: 21 para um produto específico) ou — se jurídico permitir — abrandar. O corte global do `.env` é apenas fallback quando o tenant não definiu.
> - **Nuance legal (out of scope):** a ferramenta devolve a **faixa/veredito**. O **vínculo/consentimento parental** para menores de 16 (Art. 14 LGPD e ECA) é **responsabilidade do TENANT**, não da plataforma — este plano NÃO implementa fluxo de responsável legal. Apenas sinaliza a faixa para o tenant agir.
> - **Sem biometria:** `age_band` é metadado derivado (string), nunca imagem.

---

## File Structure

```
apps/api/src/
├── verification/
│   ├── age-band.ts                       # NEW: classifyAgeBand + AGE_BAND_THRESHOLDS (puro, TDD)
│   ├── age-band.spec.ts                  # NEW
│   ├── decision.ts                       # UNCHANGED (assinatura preservada)
│   ├── record-builder.ts                 # MOD: inclui ageBand no record (Plano 1)
│   ├── verification-record.entity.ts     # MOD: + age_band (Plano 1)
│   ├── verification.service.ts           # MOD: aceita effectiveCutoff opcional; expõe age_band no payload
│   ├── verification.processor.ts         # MOD: monta cfg efetivo com tenant.requiredAge
│   └── document/
│       ├── document.processor.ts         # MOD: usa tenant.requiredAge no cutoff + age_band
│       └── document-record-builder.ts    # MOD: inclui ageBand (Plano 1)
├── tenant/
│   ├── tenant.entity.ts                  # MOD: + requiredAge
│   ├── tenant-settings.service.ts        # NEW: ler/atualizar required_age via runScoped (TDD)
│   ├── tenant-settings.service.spec.ts   # NEW
│   ├── tenant.controller.ts              # MOD: GET/PUT /tenants/me/settings (ApiKeyGuard)
│   └── tenant.module.ts                  # MOD: provider TenantSettingsService
├── db/migrations/0007-tenant-required-age.ts  # NEW
packages/sdk-types/src/index.ts           # MOD: AgeBand type + WebhookPayload.age_band?
apps/api/test/age-bands-smoke.md          # NEW
```

---

## Task 1: Pure age-band classifier

**Files:**
- Create: `apps/api/src/verification/age-band.ts`, `apps/api/src/verification/age-band.spec.ts`
- Modify: `packages/sdk-types/src/index.ts`

- [ ] **Step 1: Add the `AgeBand` type to `packages/sdk-types/src/index.ts`**

Append after `DecisionConfig`:
```ts
// Faixas etárias (defaults sensatos alinhados ao ECA — CONFIRMAR COM JURÍDICO).
export const AGE_BANDS = ['crianca', 'adolescente_jovem', 'adolescente', 'adulto'] as const;
export type AgeBand = typeof AGE_BANDS[number];
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/verification/age-band.spec.ts`
```ts
import { classifyAgeBand, AGE_BAND_THRESHOLDS } from './age-band';

test('classifies a young child as crianca (<12)', () => {
  expect(classifyAgeBand(8)).toBe('crianca');
  expect(classifyAgeBand(11)).toBe('crianca');
});

test('classifies 12-15 as adolescente_jovem', () => {
  expect(classifyAgeBand(12)).toBe('adolescente_jovem');
  expect(classifyAgeBand(15)).toBe('adolescente_jovem');
});

test('classifies 16-17 as adolescente', () => {
  expect(classifyAgeBand(16)).toBe('adolescente');
  expect(classifyAgeBand(17)).toBe('adolescente');
});

test('classifies 18+ as adulto', () => {
  expect(classifyAgeBand(18)).toBe('adulto');
  expect(classifyAgeBand(40)).toBe('adulto');
});

test('returns null for unknown age', () => {
  expect(classifyAgeBand(null)).toBeNull();
});

test('thresholds are named constants (confirmar com jurídico)', () => {
  expect(AGE_BAND_THRESHOLDS).toEqual({ crianca: 12, adolescenteJovem: 16, adulto: 18 });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest age-band`
Expected: FAIL — cannot find './age-band'.

- [ ] **Step 4: Write `apps/api/src/verification/age-band.ts`**

```ts
import { AgeBand } from '@eca/sdk-types';

/**
 * Limiares das faixas etárias.
 * DEFAULTS SENSATOS alinhados aos marcos clássicos do ECA (12 e 16) — NÃO são
 * imposição literal da Lei 15.211/2025. CONFIRMAR COM JURÍDICO antes de produção.
 * Centralizados aqui para troca trivial.
 */
export const AGE_BAND_THRESHOLDS = {
  crianca: 12, // idade < 12 → crianca
  adolescenteJovem: 16, // 12..15 → adolescente_jovem
  adulto: 18, // 16..17 → adolescente ; >= 18 → adulto
} as const;

/** Mapa puro idade → faixa. Retorna null quando a idade é desconhecida. */
export function classifyAgeBand(age: number | null | undefined): AgeBand | null {
  if (age === null || age === undefined || !Number.isFinite(age)) return null;
  if (age < AGE_BAND_THRESHOLDS.crianca) return 'crianca';
  if (age < AGE_BAND_THRESHOLDS.adolescenteJovem) return 'adolescente_jovem';
  if (age < AGE_BAND_THRESHOLDS.adulto) return 'adolescente';
  return 'adulto';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest age-band`
Expected: PASS (6 tests).

- [ ] **Step 6: Build the sdk-types package** so the new type is visible to the API.

Run: `npx tsc -b packages/sdk-types`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/verification/age-band.ts apps/api/src/verification/age-band.spec.ts packages/sdk-types/src/index.ts
git commit -m "feat(verification): pure age-band classifier (crianca/adolescente_jovem/adolescente/adulto)"
```

---

## Task 2: `required_age` on the tenant (migration 0007 + entity)

**Files:**
- Create: `apps/api/src/db/migrations/0007-tenant-required-age.ts`
- Modify: `apps/api/src/tenant/tenant.entity.ts`

- [ ] **Step 1: Write `apps/api/src/db/migrations/0007-tenant-required-age.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantRequiredAge1717632000007 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Per-tenant cutoff age; defaults to 18 so existing tenants keep current behaviour.
    await q.query(`ALTER TABLE tenants ADD COLUMN required_age int NOT NULL DEFAULT 18`);
    // Defensive guard so a bad UPDATE can never store an impossible cutoff.
    await q.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_required_age_range CHECK (required_age BETWEEN 1 AND 120)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants DROP CONSTRAINT tenants_required_age_range`);
    await q.query(`ALTER TABLE tenants DROP COLUMN required_age`);
  }
}
```

- [ ] **Step 2: Add the column to `apps/api/src/tenant/tenant.entity.ts`**

Add after `planId`:
```ts
  @Column({ name: 'required_age', type: 'int', default: 18 }) requiredAge!: number;
```

- [ ] **Step 3: Set `requiredAge` on register** in `apps/api/src/tenant/tenant.service.ts`

In `register()`, add `requiredAge: 18` to the `tenant` object literal so a freshly registered tenant has the default explicitly (matches the DB default):
```ts
    const tenant: Tenant = {
      id: randomUUID(),
      name: input.name,
      webhookUrl: input.webhookUrl,
      webhookSecret: encryptSecret(rawSecret, this.key),
      planId: 'free',
      requiredAge: 18,
    };
```

- [ ] **Step 4: Verify build**

Run: `npx tsc -b apps/api`
Expected: clean (existing tenant fixtures that build a `Tenant` literal in tests will need `requiredAge` — fix them in Task 4/Task 5 where they are touched; if any unrelated spec constructs a bare `Tenant`, add `requiredAge: 18` there too).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/migrations/0007-tenant-required-age.ts apps/api/src/tenant/tenant.entity.ts apps/api/src/tenant/tenant.service.ts
git commit -m "feat(tenant): per-tenant required_age column (migration 0007)"
```

---

## Task 3: TenantSettingsService (RLS-scoped read/update of required_age)

**Files:**
- Create: `apps/api/src/tenant/tenant-settings.service.ts`, `apps/api/src/tenant/tenant-settings.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/tenant/tenant-settings.service.spec.ts`
```ts
import { TenantSettingsService } from './tenant-settings.service';

function fakeDataSourceWith(tenant: any) {
  const manager = {
    findOneOrFail: jest.fn(async () => tenant),
    update: jest.fn(async (_e: any, _id: any, patch: any) => { Object.assign(tenant, patch); return { affected: 1 }; }),
  };
  // runScoped uses createQueryRunner(); fake just enough surface.
  const dataSource: any = {
    createQueryRunner: () => ({
      connect: jest.fn(),
      query: jest.fn(),
      release: jest.fn(),
      manager,
    }),
  };
  return { dataSource, manager };
}

test('reads the tenant required_age scoped to the tenant', async () => {
  const { dataSource, manager } = fakeDataSourceWith({ id: 't1', requiredAge: 18 });
  const svc = new TenantSettingsService(dataSource);
  const out = await svc.getRequiredAge('t1');
  expect(out).toBe(18);
  expect(manager.findOneOrFail).toHaveBeenCalled();
});

test('updates required_age within the valid range', async () => {
  const t = { id: 't1', requiredAge: 18 };
  const { dataSource, manager } = fakeDataSourceWith(t);
  const svc = new TenantSettingsService(dataSource);
  const out = await svc.setRequiredAge('t1', 21);
  expect(out).toBe(21);
  expect(manager.update).toHaveBeenCalledWith(expect.anything(), 't1', { requiredAge: 21 });
});

test('rejects an out-of-range required_age', async () => {
  const { dataSource } = fakeDataSourceWith({ id: 't1', requiredAge: 18 });
  const svc = new TenantSettingsService(dataSource);
  await expect(svc.setRequiredAge('t1', 0)).rejects.toThrow(/required_age/);
  await expect(svc.setRequiredAge('t1', 130)).rejects.toThrow(/required_age/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tenant-settings.service`
Expected: FAIL — cannot find './tenant-settings.service'.

- [ ] **Step 3: Write `apps/api/src/tenant/tenant-settings.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './tenant.entity';
import { runScoped } from './tenant-scope';

export const MIN_REQUIRED_AGE = 1;
export const MAX_REQUIRED_AGE = 120;

@Injectable()
export class TenantSettingsService {
  constructor(private readonly dataSource: DataSource) {}

  async getRequiredAge(tenantId: string): Promise<number> {
    return runScoped(this.dataSource, tenantId, async (mgr) => {
      const tenant = await mgr.findOneOrFail(Tenant, { where: { id: tenantId } });
      return tenant.requiredAge;
    });
  }

  async setRequiredAge(tenantId: string, requiredAge: number): Promise<number> {
    if (!Number.isInteger(requiredAge) || requiredAge < MIN_REQUIRED_AGE || requiredAge > MAX_REQUIRED_AGE) {
      throw new Error(`required_age must be an integer in [${MIN_REQUIRED_AGE}, ${MAX_REQUIRED_AGE}]`);
    }
    return runScoped(this.dataSource, tenantId, async (mgr) => {
      // RLS WITH CHECK guarantees the row belongs to this tenant.
      await mgr.update(Tenant, tenantId, { requiredAge });
      return requiredAge;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tenant-settings.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tenant/tenant-settings.service.ts apps/api/src/tenant/tenant-settings.service.spec.ts
git commit -m "feat(tenant): RLS-scoped settings service for required_age"
```

---

## Task 4: Settings endpoints (read/set required_age) + module wiring

**Files:**
- Modify: `apps/api/src/tenant/tenant.controller.ts`, `apps/api/src/tenant/tenant.module.ts`

- [ ] **Step 1: Add the endpoints to `apps/api/src/tenant/tenant.controller.ts`**

Add imports at the top (extend the existing `@nestjs/common` import with `Get`, `Put`):
```ts
import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { TenantSettingsService } from './tenant-settings.service';
```
Inject the settings service in the constructor (append — do NOT reorder existing params):
```ts
  constructor(
    private readonly tenants: TenantService,
    private readonly apiKeys: ApiKeyService,
    private readonly settings: TenantSettingsService,
  ) {}
```
Add the two handlers (the caller is identified by its API key; RLS scopes the row):
```ts
  // Read the caller's own cutoff (and the band thresholds note lives in docs).
  @Get('me/settings')
  @UseGuards(ApiKeyGuard)
  async getSettings(@Req() req: any) {
    const requiredAge = await this.settings.getRequiredAge(req.tenant.id);
    return { required_age: requiredAge };
  }

  // Set the caller's own cutoff. Validation + RLS protect against bad/foreign writes.
  @Put('me/settings')
  @UseGuards(ApiKeyGuard)
  async setSettings(@Req() req: any, @Body() body: { required_age?: unknown }) {
    if (typeof body.required_age !== 'number' || !Number.isInteger(body.required_age)) {
      throw new BadRequestException('required_age must be an integer');
    }
    try {
      const requiredAge = await this.settings.setRequiredAge(req.tenant.id, body.required_age);
      return { required_age: requiredAge };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
```

- [ ] **Step 2: Register `TenantSettingsService` in `apps/api/src/tenant/tenant.module.ts`**

Add `TenantSettingsService` to the `providers` array (with import). It depends only on `DataSource`, which Nest already provides via the TypeORM module.

- [ ] **Step 3: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest tenant`
Expected: tsc clean; tenant suites green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/tenant/tenant.controller.ts apps/api/src/tenant/tenant.module.ts
git commit -m "feat(tenant): GET/PUT /tenants/me/settings for required_age (ApiKeyGuard + RLS)"
```

---

## Task 5: Thread per-tenant cutoff + age_band through the age/liveness path

**Files:**
- Modify: `packages/sdk-types/src/index.ts`, `apps/api/src/verification/record-builder.ts`, `apps/api/src/verification/verification-record.entity.ts`, `apps/api/src/db/migrations/0006-verification-records.ts` (only if not yet applied; otherwise a forward ALTER — see Step 2), `apps/api/src/verification/verification.service.ts`, `apps/api/src/verification/verification.processor.ts`

> Depends on Plano 1 (`verification_records` + `record-builder` + `WebhookPayload.proof`). The `age_band` column is ADDED to the records table created by Plano 1.

- [ ] **Step 1: Extend `WebhookPayload` in `packages/sdk-types/src/index.ts`**

Add an optional band field (next to `proof?` from Plano 1):
```ts
  age_band?: import('./index').AgeBand; // faixa etária derivada (opcional)
```
(If a self-import alias is awkward, declare it inline: `age_band?: AgeBand;` — `AgeBand` is already exported in this file.)

- [ ] **Step 2: Add `age_band` to the records table + entity**

If migration **0006** (Plano 1) has NOT been applied to any live DB yet, add the column directly to its `CREATE TABLE` and the entity. Otherwise, add it in **0007** as a forward ALTER. Recommended (consistent with this plan owning 0007): put the ALTER in **0007** so 0006 stays exactly as Plano 1 shipped it.

In `apps/api/src/db/migrations/0007-tenant-required-age.ts` `up()`, append:
```ts
    // Derived age band on the audit trail (string metadata, never biometrics).
    await q.query(`ALTER TABLE verification_records ADD COLUMN age_band text`);
```
and in `down()` (prepend, before dropping the tenants column):
```ts
    await q.query(`ALTER TABLE verification_records DROP COLUMN age_band`);
```

In `apps/api/src/verification/verification-record.entity.ts`, add:
```ts
  @Column({ name: 'age_band', type: 'text', nullable: true }) ageBand!: string | null;
```

- [ ] **Step 3: Write the failing test for the enriched record builder**

Add to `apps/api/src/verification/record-builder.spec.ts`:
```ts
import { classifyAgeBand } from './age-band';

test('buildAgeRecord includes the derived age band', () => {
  const rec = buildAgeRecord({
    transactionId: 'tx1', tenantId: 'ten1',
    result: { estimatedAge: 14, livenessScore: 0.9 }, cfg, status: 'documento_requerido',
    provider: 'mock', modelVersion: 'mock-1', now: new Date('2026-06-07T00:00:00Z'),
  });
  expect(rec.ageBand).toBe('adolescente_jovem');
  expect(classifyAgeBand(14)).toBe('adolescente_jovem');
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest record-builder`
Expected: FAIL — `rec.ageBand` is undefined.

- [ ] **Step 5: Add `ageBand` to `buildAgeRecord` in `apps/api/src/verification/record-builder.ts`**

Add the import and the field (do NOT change the function signature):
```ts
import { classifyAgeBand } from './age-band';
```
Inside the returned object of `buildAgeRecord`, add:
```ts
    ageBand: classifyAgeBand(input.result.estimatedAge),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest record-builder`
Expected: PASS (existing + new test).

- [ ] **Step 7: Use the per-tenant cutoff + attach `age_band` in `verification.service.ts`**

Extend `VerifyArgs` (append optional fields — keep `decideVerification`'s signature untouched):
```ts
  effectiveCutoffAge?: number; // per-tenant override of cfg.cutoffAge
```
In `verify()`, build the effective config BEFORE deciding, and set the band on the payload:
```ts
      const effectiveCfg: DecisionConfig = args.effectiveCutoffAge
        ? { ...this.cfg, cutoffAge: args.effectiveCutoffAge }
        : this.cfg;
      const providerResult = await this.provider.analyze(frame);
      const status = decideVerification(providerResult, effectiveCfg);
      const payload: WebhookPayload = {
        transaction_id: args.transactionId,
        status,
        is_over_18: isOver18(status),
        age_band: classifyAgeBand(providerResult.estimatedAge) ?? undefined,
      };
```
Add the import:
```ts
import { classifyAgeBand } from './age-band';
```
Where the record is built (Plano 1 branch), pass `effectiveCfg` instead of `this.cfg` so the persisted `cutoff_age`/band reflect the tenant's cutoff:
```ts
        const record = buildAgeRecord({
          transactionId: args.transactionId, tenantId: args.tenantId,
          result: providerResult, cfg: effectiveCfg, status,
          provider: args.provider ?? 'mock', modelVersion: args.modelVersion ?? 'unknown', now: new Date(),
        });
```

- [ ] **Step 8: Pass the tenant cutoff from the processor**

In `apps/api/src/verification/verification.processor.ts`, the `runScoped` callback already loads `tenant`. Pass its cutoff into `service.verify`:
```ts
          effectiveCutoffAge: tenant.requiredAge,
```
(append to the existing `verify({ ... })` args — do NOT change the processor constructor).

- [ ] **Step 9: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all green. Update `verification.service.spec.ts`: with `effectiveCutoffAge` omitted, `effectiveCfg === this.cfg`, so existing decisions are unchanged. Any test fixture that builds a `Tenant` literal must include `requiredAge` (e.g. `requiredAge: 18`).

- [ ] **Step 10: Commit**

```bash
git add packages/sdk-types/src/index.ts apps/api/src/verification/record-builder.ts apps/api/src/verification/record-builder.spec.ts apps/api/src/verification/verification-record.entity.ts apps/api/src/db/migrations/0007-tenant-required-age.ts apps/api/src/verification/verification.service.ts apps/api/src/verification/verification.service.spec.ts apps/api/src/verification/verification.processor.ts
git commit -m "feat(verification): per-tenant cutoff + age_band on age/liveness path"
```

---

## Task 6: Thread per-tenant cutoff + age_band through the document path

**Files:**
- Modify: `apps/api/src/verification/document/document-record-builder.ts`, `apps/api/src/verification/document/document-record-builder.spec.ts`, `apps/api/src/verification/document/document.processor.ts`

> Depends on Plano 1's `document-record-builder` + `DocumentProcessor` record wiring.

- [ ] **Step 1: Write the failing test for the document band**

Add to `apps/api/src/verification/document/document-record-builder.spec.ts`:
```ts
test('document record includes the derived age band', () => {
  const rec = buildDocumentRecord({
    transactionId: 'tx2', tenantId: 'ten1', status: 'reprovado',
    ageFromDoc: 15, faceMatchScore: 0.95, cutoffAge: 18, provider: 'mock', modelVersion: 'mock-1',
    now: new Date('2026-06-07T00:00:00Z'),
  });
  expect(rec.ageBand).toBe('adolescente_jovem');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest document-record-builder`
Expected: FAIL — `rec.ageBand` is undefined.

- [ ] **Step 3: Add `ageBand` to `buildDocumentRecord`**

In `apps/api/src/verification/document/document-record-builder.ts`, add the import and the field inside the returned object:
```ts
import { classifyAgeBand } from '../age-band';
```
```ts
    ageBand: classifyAgeBand(i.ageFromDoc),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest document-record-builder`
Expected: PASS.

- [ ] **Step 5: Use the tenant cutoff + age_band in `document.processor.ts`**

Inside the `runScoped` block, `tenant` is already loaded. Replace `this.cfg.cutoffAge` usages with the tenant's cutoff and attach the band:
```ts
      const effectiveCutoff = tenant.requiredAge ?? this.cfg.cutoffAge;
      const status = decideDocument({ ageFromDoc, faceMatchScore: out.faceMatchScore, identical: out.identical }, effectiveCutoff, Number(process.env.DOC_FACEMATCH_MIN ?? 0.8));
      const payload: WebhookPayload = {
        transaction_id: job.transactionId,
        status,
        is_over_18: isOver18(status),
        age_band: classifyAgeBand(ageFromDoc) ?? undefined,
      };
```
> NOTE: the current `document.processor.ts` computes `status` BEFORE entering `runScoped` (it loads `tenant` only inside). This task moves the `status`/`payload` computation INTO the `runScoped` block (right after `findOneOrFail(Tenant)`), so the tenant cutoff is available. The `decideDocument` call and `payload` construction move down accordingly; everything else (audit, webhook, Plano 1 record/proof) stays inside the same block. Add the import:
```ts
import { classifyAgeBand } from '../age-band';
```
And where Plano 1 builds the document record, pass `cutoffAge: effectiveCutoff` instead of `this.cfg.cutoffAge`.

- [ ] **Step 6: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all green. Update `document.processor.spec.ts`: the fake tenant returned by `findOneOrFail` must carry `requiredAge` (e.g. `18`); with `requiredAge: 18` the existing cutoff behaviour is preserved.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/verification/document/document-record-builder.ts apps/api/src/verification/document/document-record-builder.spec.ts apps/api/src/verification/document/document.processor.ts apps/api/src/verification/document/document.processor.spec.ts
git commit -m "feat(document): per-tenant cutoff + age_band on document path"
```

---

## Task 7: Age-bands smoke (manual)

**Files:**
- Create: `apps/api/test/age-bands-smoke.md`

- [ ] **Step 1: Write `apps/api/test/age-bands-smoke.md`**

````markdown
# Age bands + per-tenant cutoff smoke (requires infra)

1. Run migrations (0001–0007), start API + workers, seed a tenant.
2. Read the cutoff: `curl -H "Authorization: Bearer <api-key>" http://localhost:3000/tenants/me/settings` → `{ "required_age": 18 }`.
3. Raise it: `curl -X PUT -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" -d '{"required_age":21}' http://localhost:3000/tenants/me/settings` → `{ "required_age": 21 }`.
4. Bad value: `-d '{"required_age":0}'` → 400; `-d '{"required_age":"x"}'` → 400.
5. Run a verification for a 19-year-old face with cutoff=21 → now lands in the grey zone / `documento_requerido` (cutoff is the tenant's, not the global env).
6. Inspect the trail: `psql ... -c "SELECT method, estimated_age, cutoff_age, age_band, decision_reason FROM verification_records ORDER BY created_at DESC LIMIT 5;"` → `cutoff_age` reflects the tenant's 21, `age_band` populated (e.g. `adulto` for 19? NO — 19 is `adulto` by band but below the tenant cutoff; band and verdict are independent — verify both columns make sense).
7. The final webhook payload now carries `age_band` (optional).
8. Cross-tenant isolation: a second tenant's key reading `/tenants/me/settings` returns ITS own cutoff (RLS), never the first tenant's.

> LEGAL: the tool reports the band. Parental linkage/consent for <16 is the TENANT's responsibility — out of scope here.
````

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest`
Expected: all suites green, including age-band, tenant-settings.service, record-builder (band), document-record-builder (band).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/age-bands-smoke.md
git commit -m "test(age-bands): per-tenant cutoff + bands smoke checklist"
```

---

## Self-Review Notes

- **Compliance coverage (item 4):** faixas de menores → `classifyAgeBand` + `AGE_BAND_THRESHOLDS` (Task 1), persistidas em `verification_records.age_band` (Tasks 5–6) e opcionalmente no webhook (`WebhookPayload.age_band?`); corte por tenant → `tenants.required_age` (0007), `TenantSettingsService`, endpoints `GET/PUT /tenants/me/settings`, threading via `effectiveCutoffAge`/`tenant.requiredAge` em ambos os caminhos (Tasks 2–6).
- **`decideVerification` intacto:** sua assinatura NÃO mudou; o corte por-tenant é aplicado montando um `DecisionConfig` efetivo (`{ ...cfg, cutoffAge }`) ANTES da chamada. A faixa é um helper ADICIONAL (`classifyAgeBand`), não um parâmetro novo na regra. `isOver18` continua funcionando.
- **Fallback global preservado:** quando o tenant não tem `required_age` definido (ou é `null` em fixtures legados), cai no `cfg.cutoffAge` do `.env`.
- **Sem biometria:** `age_band` é string derivada da idade; nenhuma coluna/campo novo carrega imagem.
- **Tenant isolation:** `required_age` lido/escrito via `runScoped` + `ApiKeyGuard`; RLS `WITH CHECK` impede gravar/ler o corte de outro tenant; a CHECK constraint impede valores impossíveis no banco.
- **Type consistency:** `AgeBand`/`AGE_BANDS` em `sdk-types`; `classifyAgeBand` usada por `verification.service`, `record-builder` e `document-record-builder`; `WebhookPayload.age_band?` setado por ambos os caminhos; `effectiveCutoffAge` opcional não quebra chamadas existentes.
- **Reuso de padrões:** migration RLS/ALTER no estilo 0004; `runScoped` (Onda 2); `ApiKeyGuard`; extensão de `WebhookPayload` (como o `proof?` do Plano 1); `verification_records` (Plano 1) estendida em vez de recriada.
- **No placeholders:** todo passo tem código completo. Zero dependência nova.
- **Deferred (needs infra):** migration 0007 live-run e o smoke (Task 7). Toda a lógica é unit-testada (classificador puro; settings via fake DataSource; builders via record).
- **ASSUNÇÕES FLAGGED P/ O USUÁRIO / JURÍDICO:** (1) limiares 12/16/18 das faixas são defaults sensatos, **não** literais da Lei 15.211/2025 — **confirmar**; (2) `required_age` default 18 e a possibilidade de abrandá-lo dependem de parecer jurídico; (3) **vínculo/consentimento parental para <16 é responsabilidade do TENANT** (out of scope) — a ferramenta só devolve a faixa/veredito.
- **Follow-ups:** próximo plano (Onda 3/3) cobre consentimento (LGPD Art. 14) + prova de descarte/erasure; calibração fina da margem etária por faixa fica para o motor de IA real (#2).
