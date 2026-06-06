# ECA Verify — #2 Motor de IA Real (CAF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `MockAgeProvider` with a real Brazilian KYC provider (CAF / Combate à Fraude) behind the existing `AgeProviderPort`, and implement the grey-zone document step (OCR + face match) so a `documento_requerido` outcome can be resolved into a final `aprovado`/`reprovado`.

**Architecture:** A `CafClient` wraps CAF's OAuth2 + transaction API (create transaction with services, poll until complete). Two adapters sit behind ports: `CafAgeProvider` (`AgeProviderPort`, age range + liveness) and `CafDocumentVerifier` (new `DocumentVerifierPort`, OCR birthDate + facematch). Provider selection is config-driven (`mock` | `caf`) so dev/tests keep using the mock. The document flow reuses the existing async machinery (frame store, queue, worker, RLS, signed webhook, single-use session): on `documento_requerido` the worker issues a single-use `document_session_token` (returned in the webhook); the tenant re-mounts the plugin in document mode, which posts the document + selfie to `POST /verify/document`, enqueuing a document job that the worker resolves into a final webhook.

**Tech Stack:** Builds on the merged codebase (NestJS, TypeORM/Postgres, Redis/BullMQ, Jest). Reuses `AgeProviderPort`/`AGE_PROVIDER`, `crypto.util`, `frame-codec`, `FrameStorePort`, `VerificationQueue`/`OnceGuard`, `withTenantScope`, `WebhookService`, `secret-crypto`, the single-use session pattern.

> **Scope note:** This is two coherent halves — Part A (real age/liveness) and Part B (document flow). They can be executed and reviewed as two batches. Part A alone already delivers "motor de IA real" for the clear-cut cases.

> **Live calls deferred:** real CAF calls need sandbox credentials (`CAF_CLIENT_ID`/`CAF_CLIENT_SECRET`). All logic is unit-tested with an injected fake `fetch`/client; live verification is a follow-up once credentials exist. Two CAF specifics are assumed and MUST be confirmed in the sandbox: (1) images are sent base64-encoded in the transaction JSON; (2) `probability`/`confidence` are on a 0–100 scale (normalized via `CAF_SCORE_SCALE`, default `100`).

---

## File Structure

```
apps/api/src/
├── config.ts                          # MODIFIED: provider kinds + CAF settings
├── verification/
│   ├── age-provider.port.ts           # (exists)
│   ├── caf/
│   │   ├── caf-client.ts              # OAuth token cache + createTransaction + awaitTransaction (TDD)
│   │   ├── caf-mappers.ts             # extract age/liveness + document from a transaction (TDD)
│   │   ├── caf-age-provider.ts        # AgeProviderPort impl (TDD)
│   │   └── caf-document-verifier.ts   # DocumentVerifierPort impl (TDD)
│   ├── document/
│   │   ├── document-verifier.port.ts  # DocumentVerifierPort + DOC_VERIFIER symbol
│   │   ├── mock-document-verifier.ts  # mock impl
│   │   ├── document-decision.ts       # decideDocument + ageFromBirthDate (pure, TDD)
│   │   └── document.processor.ts      # worker-side doc job (TDD)
│   ├── provider-factory.ts            # selects mock|caf for both ports (TDD)
│   ├── verification.processor.ts      # MODIFIED: issue document_session on documento_requerido
│   ├── document.controller.ts         # NEW: POST /verify/document
│   └── verification.module.ts         # MODIFIED: wire factory + doc flow
├── session/
│   └── document-session.entity.ts     # NEW
├── queue/
│   └── document-job.ts                # NEW: job contract + builder (TDD)
├── webhook/                           # (reuse WebhookService)
└── db/migrations/0003-document-session.ts   # NEW
packages/sdk-types/src/index.ts        # MODIFIED: webhook payload + DocumentResult types
packages/plugin/src/document.ts        # NEW: document-mode capture entry
```

---

# PART A — Real age/liveness via CAF

## Task A1: Config — provider selection + CAF settings

**Files:**
- Modify: `apps/api/src/config.ts`
- Test: `apps/api/src/config.spec.ts` (extend)

- [ ] **Step 1: Write the failing test (append to `config.spec.ts`)**

```ts
import { loadProviderConfig } from './config';

test('defaults both providers to mock when unset', () => {
  expect(loadProviderConfig({})).toMatchObject({ ageKind: 'mock', docKind: 'mock' });
});

test('reads caf settings from env', () => {
  const cfg = loadProviderConfig({
    AGE_PROVIDER_KIND: 'caf', DOC_VERIFIER_KIND: 'caf',
    CAF_BASE_URL: 'https://api.us.prd.caf.io', CAF_CLIENT_ID: 'id', CAF_CLIENT_SECRET: 'sec',
    CAF_SCORE_SCALE: '100', CAF_TIMEOUT_MS: '8000', CAF_POLL_INTERVAL_MS: '500', CAF_POLL_MAX_ATTEMPTS: '20',
  });
  expect(cfg).toEqual({
    ageKind: 'caf', docKind: 'caf',
    caf: { baseUrl: 'https://api.us.prd.caf.io', clientId: 'id', clientSecret: 'sec',
           scoreScale: 100, timeoutMs: 8000, pollIntervalMs: 500, pollMaxAttempts: 20 },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest config`
Expected: FAIL — `loadProviderConfig` is not a function.

- [ ] **Step 3: Add to `apps/api/src/config.ts`**

```ts
export type ProviderKind = 'mock' | 'caf';

export interface CafConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scoreScale: number;
  timeoutMs: number;
  pollIntervalMs: number;
  pollMaxAttempts: number;
}

export interface ProviderConfig {
  ageKind: ProviderKind;
  docKind: ProviderKind;
  caf?: CafConfig;
}

export function loadProviderConfig(env: NodeJS.ProcessEnv): ProviderConfig {
  const ageKind = (env.AGE_PROVIDER_KIND ?? 'mock') as ProviderKind;
  const docKind = (env.DOC_VERIFIER_KIND ?? 'mock') as ProviderKind;
  const cfg: ProviderConfig = { ageKind, docKind };
  if (ageKind === 'caf' || docKind === 'caf') {
    cfg.caf = {
      baseUrl: env.CAF_BASE_URL ?? '',
      clientId: env.CAF_CLIENT_ID ?? '',
      clientSecret: env.CAF_CLIENT_SECRET ?? '',
      scoreScale: Number(env.CAF_SCORE_SCALE ?? 100),
      timeoutMs: Number(env.CAF_TIMEOUT_MS ?? 8000),
      pollIntervalMs: Number(env.CAF_POLL_INTERVAL_MS ?? 500),
      pollMaxAttempts: Number(env.CAF_POLL_MAX_ATTEMPTS ?? 20),
    };
  }
  return cfg;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest config`
Expected: PASS.

- [ ] **Step 5: Append the new keys to `.env.example`**

```
AGE_PROVIDER_KIND=mock
DOC_VERIFIER_KIND=mock
CAF_BASE_URL=https://api.us.prd.caf.io
CAF_CLIENT_ID=
CAF_CLIENT_SECRET=
CAF_SCORE_SCALE=100
CAF_TIMEOUT_MS=8000
CAF_POLL_INTERVAL_MS=500
CAF_POLL_MAX_ATTEMPTS=20
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/config.spec.ts .env.example
git commit -m "feat(config): provider selection (mock|caf) + CAF settings"
```

---

## Task A2: CAF transaction mappers (pure)

**Files:**
- Create: `apps/api/src/verification/caf/caf-mappers.ts`
- Test: `apps/api/src/verification/caf/caf-mappers.spec.ts`

> CAF returns a transaction with a `services` array; each service has a `name` and a `data` object. We extract liveness `probability` + face-details `ageRangeLow/High`, and (Part B) OCR `birthDate` + facematch `confidence`/`identical`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/caf/caf-mappers.spec.ts`
```ts
import { extractAgeLiveness, isTransactionComplete } from './caf-mappers';

const tx = {
  status: 'COMPLETED',
  services: [
    { name: 'face_liveness', status: 'COMPLETED', data: { info: { probability: 95, openEyesProbability: 99 } } },
    { name: 'face_details', status: 'COMPLETED', data: { ageRangeLow: 17, ageRangeHigh: 21 } },
  ],
};

test('extracts liveness score (normalized) and the conservative low age', () => {
  const r = extractAgeLiveness(tx, 100);
  expect(r.livenessScore).toBeCloseTo(0.95);
  expect(r.estimatedAge).toBe(17); // use ageRangeLow — conservative for the cutoff
});

test('throws if a required service is missing', () => {
  expect(() => extractAgeLiveness({ status: 'COMPLETED', services: [] }, 100)).toThrow(/face/i);
});

test('isTransactionComplete is true only when all services are COMPLETED', () => {
  expect(isTransactionComplete(tx)).toBe(true);
  expect(isTransactionComplete({ status: 'PENDING', services: [{ name: 'x', status: 'PENDING', data: {} }] })).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest caf-mappers`
Expected: FAIL — cannot find './caf-mappers'.

- [ ] **Step 3: Write `apps/api/src/verification/caf/caf-mappers.ts`**

```ts
import { AgeProviderResult } from '@eca/sdk-types';

export interface CafService { name: string; status: string; data: any; }
export interface CafTransaction { status: string; services: CafService[]; }

function service(tx: CafTransaction, name: string): CafService {
  const s = tx.services?.find((x) => x.name === name);
  if (!s) throw new Error(`CAF transaction missing service: ${name}`);
  return s;
}

export function isTransactionComplete(tx: CafTransaction): boolean {
  if (!tx.services?.length) return false;
  return tx.services.every((s) => s.status === 'COMPLETED');
}

export function extractAgeLiveness(tx: CafTransaction, scoreScale: number): AgeProviderResult {
  const liveness = service(tx, 'face_liveness');
  const face = service(tx, 'face_details');
  return {
    livenessScore: Number(liveness.data?.info?.probability ?? 0) / scoreScale,
    // ageRangeLow is the conservative bound: harder to clear the cutoff, never over-approves.
    estimatedAge: Number(face.data?.ageRangeLow ?? 0),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest caf-mappers`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/caf/caf-mappers.ts apps/api/src/verification/caf/caf-mappers.spec.ts
git commit -m "feat(caf): age/liveness transaction mappers"
```

---

## Task A3: CAF client (token cache + create + poll)

**Files:**
- Create: `apps/api/src/verification/caf/caf-client.ts`
- Test: `apps/api/src/verification/caf/caf-client.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/caf/caf-client.spec.ts`
```ts
import { CafClient } from './caf-client';
import { CafConfig } from '../../config';

const cfg: CafConfig = {
  baseUrl: 'https://caf.test', clientId: 'id', clientSecret: 'sec',
  scoreScale: 100, timeoutMs: 1000, pollIntervalMs: 0, pollMaxAttempts: 5,
};

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body } as any;
}

test('fetches and caches an OAuth token, reused across calls', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(jsonResponse({ access_token: 't1', expires_in: 3600 })) // token
    .mockResolvedValueOnce(jsonResponse({ id: 'tx1' }));                            // createTransaction
  const client = new CafClient(cfg, fetchMock as any, () => 1000);
  const created = await client.createTransaction({ foo: 'bar' });
  expect(created.id).toBe('tx1');
  // a second create reuses the cached token (no new /token call)
  fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'tx2' }));
  await client.createTransaction({ foo: 'baz' });
  const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/token'));
  expect(tokenCalls).toHaveLength(1);
});

test('awaitTransaction polls until all services COMPLETED', async () => {
  const pending = jsonResponse({ status: 'PENDING', services: [{ name: 'x', status: 'PENDING', data: {} }] });
  const done = jsonResponse({ status: 'COMPLETED', services: [{ name: 'x', status: 'COMPLETED', data: {} }] });
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(jsonResponse({ access_token: 't', expires_in: 3600 }))
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce(done);
  const client = new CafClient(cfg, fetchMock as any, () => 1000);
  const tx = await client.awaitTransaction('tx1');
  expect(tx.status).toBe('COMPLETED');
});

test('awaitTransaction throws after pollMaxAttempts', async () => {
  const pending = () => jsonResponse({ status: 'PENDING', services: [{ name: 'x', status: 'PENDING', data: {} }] });
  const fetchMock = jest.fn().mockResolvedValue(pending());
  fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 't', expires_in: 3600 }));
  const client = new CafClient({ ...cfg, pollMaxAttempts: 2 }, fetchMock as any, () => 1000);
  await expect(client.awaitTransaction('tx1')).rejects.toThrow(/timed out/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest caf-client`
Expected: FAIL — cannot find './caf-client'.

- [ ] **Step 3: Write `apps/api/src/verification/caf/caf-client.ts`**

```ts
import { CafConfig } from '../../config';
import { CafTransaction, isTransactionComplete } from './caf-mappers';

type FetchFn = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export class CafClient {
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly cfg: CafConfig,
    private readonly fetchFn: FetchFn = fetch as any,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  private async authHeader(): Promise<string> {
    if (this.token && this.nowMs() < this.token.expiresAtMs) return `Bearer ${this.token.value}`;
    const res = await this.fetchFn(`${this.cfg.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
    });
    if (!res.ok) throw new Error(`CAF token request failed: ${res.status}`);
    const body = await res.json();
    // Refresh 60s before expiry to avoid edge races.
    this.token = { value: body.access_token, expiresAtMs: this.nowMs() + (Number(body.expires_in) - 60) * 1000 };
    return `Bearer ${this.token.value}`;
  }

  async createTransaction(payload: unknown): Promise<{ id: string }> {
    const res = await this.fetchFn(`${this.cfg.baseUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await this.authHeader() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`CAF createTransaction failed: ${res.status}`);
    const body = await res.json();
    return { id: body.id };
  }

  async getTransaction(id: string): Promise<CafTransaction> {
    const res = await this.fetchFn(`${this.cfg.baseUrl}/transactions/${id}`, {
      method: 'GET',
      headers: { Authorization: await this.authHeader() },
    });
    if (!res.ok) throw new Error(`CAF getTransaction failed: ${res.status}`);
    return res.json();
  }

  async awaitTransaction(id: string): Promise<CafTransaction> {
    for (let attempt = 0; attempt < this.cfg.pollMaxAttempts; attempt++) {
      const tx = await this.getTransaction(id);
      if (isTransactionComplete(tx)) return tx;
      if (this.cfg.pollIntervalMs > 0) await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
    }
    throw new Error(`CAF transaction ${id} timed out after ${this.cfg.pollMaxAttempts} attempts`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest caf-client`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/caf/caf-client.ts apps/api/src/verification/caf/caf-client.spec.ts
git commit -m "feat(caf): client with token cache + transaction polling"
```

---

## Task A4: CafAgeProvider (AgeProviderPort)

**Files:**
- Create: `apps/api/src/verification/caf/caf-age-provider.ts`
- Test: `apps/api/src/verification/caf/caf-age-provider.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/caf/caf-age-provider.spec.ts`
```ts
import { CafAgeProvider } from './caf-age-provider';

test('creates a transaction with the frame and maps the completed result', async () => {
  const client = {
    createTransaction: jest.fn(async () => ({ id: 'tx1' })),
    awaitTransaction: jest.fn(async () => ({
      status: 'COMPLETED',
      services: [
        { name: 'face_liveness', status: 'COMPLETED', data: { info: { probability: 88 } } },
        { name: 'face_details', status: 'COMPLETED', data: { ageRangeLow: 24, ageRangeHigh: 28 } },
      ],
    })),
  };
  const provider = new CafAgeProvider(client as any, 100);
  const result = await provider.analyze(Buffer.from('frame-bytes'));
  expect(result.estimatedAge).toBe(24);
  expect(result.livenessScore).toBeCloseTo(0.88);
  // the frame went out base64-encoded in the requested services
  const payload = client.createTransaction.mock.calls[0][0];
  expect(JSON.stringify(payload)).toContain(Buffer.from('frame-bytes').toString('base64'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest caf-age-provider`
Expected: FAIL — cannot find './caf-age-provider'.

- [ ] **Step 3: Write `apps/api/src/verification/caf/caf-age-provider.ts`**

```ts
import { AgeProviderResult } from '@eca/sdk-types';
import { AgeProviderPort } from '../age-provider.port';
import { CafClient } from './caf-client';
import { extractAgeLiveness } from './caf-mappers';

export class CafAgeProvider implements AgeProviderPort {
  constructor(private readonly client: CafClient, private readonly scoreScale: number) {}

  async analyze(frame: Buffer): Promise<AgeProviderResult> {
    // Assumed transport: base64 image inside the transaction JSON (confirm in sandbox).
    const { id } = await this.client.createTransaction({
      services: ['face_liveness', 'face_details'],
      image: frame.toString('base64'),
    });
    const tx = await this.client.awaitTransaction(id);
    return extractAgeLiveness(tx, this.scoreScale);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest caf-age-provider`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/caf/caf-age-provider.ts apps/api/src/verification/caf/caf-age-provider.spec.ts
git commit -m "feat(caf): CafAgeProvider behind AgeProviderPort"
```

---

## Task A5: Provider factory + worker wiring (select mock|caf)

**Files:**
- Create: `apps/api/src/verification/provider-factory.ts`
- Test: `apps/api/src/verification/provider-factory.spec.ts`
- Modify: `apps/api/src/worker.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/provider-factory.spec.ts`
```ts
import { buildAgeProvider } from './provider-factory';
import { MockAgeProvider } from './mock-age-provider';
import { CafAgeProvider } from './caf/caf-age-provider';

test('returns the mock provider when ageKind is mock', () => {
  const p = buildAgeProvider({ ageKind: 'mock', docKind: 'mock' });
  expect(p).toBeInstanceOf(MockAgeProvider);
});

test('returns the CAF provider when ageKind is caf', () => {
  const p = buildAgeProvider({
    ageKind: 'caf', docKind: 'mock',
    caf: { baseUrl: 'https://caf.test', clientId: 'i', clientSecret: 's', scoreScale: 100, timeoutMs: 1000, pollIntervalMs: 0, pollMaxAttempts: 3 },
  });
  expect(p).toBeInstanceOf(CafAgeProvider);
});

test('throws if caf is selected without config', () => {
  expect(() => buildAgeProvider({ ageKind: 'caf', docKind: 'mock' })).toThrow(/caf config/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest provider-factory`
Expected: FAIL — cannot find './provider-factory'.

- [ ] **Step 3: Write `apps/api/src/verification/provider-factory.ts`**

```ts
import { ProviderConfig } from '../config';
import { AgeProviderPort } from './age-provider.port';
import { MockAgeProvider } from './mock-age-provider';
import { CafClient } from './caf/caf-client';
import { CafAgeProvider } from './caf/caf-age-provider';

export function buildAgeProvider(cfg: ProviderConfig): AgeProviderPort {
  if (cfg.ageKind === 'mock') {
    return new MockAgeProvider({ estimatedAge: 30, livenessScore: 0.95 });
  }
  if (!cfg.caf) throw new Error('CAF config missing for ageKind=caf');
  return new CafAgeProvider(new CafClient(cfg.caf), cfg.caf.scoreScale);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest provider-factory`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it in `apps/api/src/worker.ts`**

Replace the inline `new MockAgeProvider(...)` passed into `VerificationService` with `buildAgeProvider(loadProviderConfig(process.env))`. Add imports:
```ts
import { buildAgeProvider } from './verification/provider-factory';
import { loadProviderConfig } from './config';
```
and change the `VerificationService` construction to use `buildAgeProvider(loadProviderConfig(process.env))` as the provider argument.

- [ ] **Step 6: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/verification/provider-factory.ts apps/api/src/verification/provider-factory.spec.ts apps/api/src/worker.ts
git commit -m "feat(verification): provider factory + worker selects mock|caf"
```

---

# PART B — Document step (OCR + face match)

## Task B1: Document decision + age-from-birthdate (pure)

**Files:**
- Create: `apps/api/src/verification/document/document-decision.ts`
- Test: `apps/api/src/verification/document/document-decision.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/document/document-decision.spec.ts`
```ts
import { ageFromBirthDate, decideDocument } from './document-decision';

test('computes age from an ISO birth date', () => {
  expect(ageFromBirthDate('2000-06-06', new Date('2026-06-06'))).toBe(26);
  expect(ageFromBirthDate('2000-06-07', new Date('2026-06-06'))).toBe(25); // birthday not yet reached
});

test('approves when faces match and the document age is >= cutoff', () => {
  expect(decideDocument({ ageFromDoc: 20, faceMatchScore: 0.9, identical: true }, 18)).toBe('aprovado');
});

test('reprova when faces do not match', () => {
  expect(decideDocument({ ageFromDoc: 40, faceMatchScore: 0.2, identical: false }, 18)).toBe('reprovado');
});

test('reprova when underage even if faces match', () => {
  expect(decideDocument({ ageFromDoc: 16, faceMatchScore: 0.95, identical: true }, 18)).toBe('reprovado');
});

test('reprova when the document age is unknown', () => {
  expect(decideDocument({ ageFromDoc: null, faceMatchScore: 0.95, identical: true }, 18)).toBe('reprovado');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest document-decision`
Expected: FAIL — cannot find './document-decision'.

- [ ] **Step 3: Write `apps/api/src/verification/document/document-decision.ts`**

```ts
import { VerificationStatus } from '@eca/sdk-types';

export interface DocumentResult {
  ageFromDoc: number | null;
  faceMatchScore: number;
  identical: boolean;
}

export function ageFromBirthDate(isoBirthDate: string, now: Date): number {
  const dob = new Date(isoBirthDate);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export function decideDocument(result: DocumentResult, cutoffAge: number): VerificationStatus {
  if (!result.identical) return 'reprovado';
  if (result.ageFromDoc === null || result.ageFromDoc < cutoffAge) return 'reprovado';
  return 'aprovado';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest document-decision`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/document/document-decision.ts apps/api/src/verification/document/document-decision.spec.ts
git commit -m "feat(document): age-from-DOB + document decision rule"
```

---

## Task B2: DocumentVerifierPort + mock + CAF document mapper

**Files:**
- Create: `apps/api/src/verification/document/document-verifier.port.ts`, `apps/api/src/verification/document/mock-document-verifier.ts`
- Modify: `apps/api/src/verification/caf/caf-mappers.ts` (add `extractDocument`)
- Test: `apps/api/src/verification/document/mock-document-verifier.spec.ts`, extend `caf-mappers.spec.ts`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/verification/document/mock-document-verifier.spec.ts`
```ts
import { MockDocumentVerifier } from './mock-document-verifier';

test('mock returns the configured document result', async () => {
  const v = new MockDocumentVerifier({ birthDate: '2000-01-01', faceMatchScore: 0.9, identical: true });
  const r = await v.verify({ documentImage: Buffer.from('d'), selfieImage: Buffer.from('s') });
  expect(r).toEqual({ birthDate: '2000-01-01', faceMatchScore: 0.9, identical: true });
});
```
Append to `apps/api/src/verification/caf/caf-mappers.spec.ts`:
```ts
import { extractDocument } from './caf-mappers';

test('extracts document birthDate + facematch from a transaction', () => {
  const tx = { status: 'COMPLETED', services: [
    { name: 'ocr', status: 'COMPLETED', data: { ocr: { birthDate: '1999-03-02', name: 'Maria' } } },
    { name: 'facematch', status: 'COMPLETED', data: { confidence: 92, identical: true } },
  ]};
  expect(extractDocument(tx, 100)).toEqual({ birthDate: '1999-03-02', faceMatchScore: 0.92, identical: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest mock-document-verifier caf-mappers`
Expected: FAIL — missing module / `extractDocument` undefined.

- [ ] **Step 3: Write the port, mock, and CAF mapper**

`apps/api/src/verification/document/document-verifier.port.ts`
```ts
export const DOC_VERIFIER = Symbol('DOC_VERIFIER');

export interface DocumentVerifyInput {
  documentImage: Buffer;
  selfieImage: Buffer;
}

export interface DocumentVerifyOutput {
  birthDate: string | null;
  faceMatchScore: number;
  identical: boolean;
}

export interface DocumentVerifierPort {
  verify(input: DocumentVerifyInput): Promise<DocumentVerifyOutput>;
}
```

`apps/api/src/verification/document/mock-document-verifier.ts`
```ts
import { DocumentVerifierPort, DocumentVerifyInput, DocumentVerifyOutput } from './document-verifier.port';

export class MockDocumentVerifier implements DocumentVerifierPort {
  constructor(private readonly fixed: DocumentVerifyOutput) {}
  async verify(_input: DocumentVerifyInput): Promise<DocumentVerifyOutput> {
    return { ...this.fixed };
  }
}
```

Append to `apps/api/src/verification/caf/caf-mappers.ts`:
```ts
import { DocumentVerifyOutput } from '../document/document-verifier.port';

export function extractDocument(tx: CafTransaction, scoreScale: number): DocumentVerifyOutput {
  const ocr = service(tx, 'ocr');
  const facematch = service(tx, 'facematch');
  return {
    birthDate: ocr.data?.ocr?.birthDate ?? null,
    faceMatchScore: Number(facematch.data?.confidence ?? 0) / scoreScale,
    identical: Boolean(facematch.data?.identical),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest mock-document-verifier caf-mappers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/verification/document/document-verifier.port.ts apps/api/src/verification/document/mock-document-verifier.ts apps/api/src/verification/caf/caf-mappers.ts apps/api/src/verification/caf/caf-mappers.spec.ts apps/api/src/verification/document/mock-document-verifier.spec.ts
git commit -m "feat(document): DocumentVerifierPort + mock + CAF document mapper"
```

---

## Task B3: CafDocumentVerifier

**Files:**
- Create: `apps/api/src/verification/caf/caf-document-verifier.ts`
- Test: `apps/api/src/verification/caf/caf-document-verifier.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/verification/caf/caf-document-verifier.spec.ts`
```ts
import { CafDocumentVerifier } from './caf-document-verifier';

test('creates an ocr+facematch transaction and maps the result', async () => {
  const client = {
    createTransaction: jest.fn(async () => ({ id: 'txd' })),
    awaitTransaction: jest.fn(async () => ({ status: 'COMPLETED', services: [
      { name: 'ocr', status: 'COMPLETED', data: { ocr: { birthDate: '2001-05-05' } } },
      { name: 'facematch', status: 'COMPLETED', data: { confidence: 80, identical: true } },
    ]})),
  };
  const v = new CafDocumentVerifier(client as any, 100);
  const r = await v.verify({ documentImage: Buffer.from('doc'), selfieImage: Buffer.from('self') });
  expect(r).toEqual({ birthDate: '2001-05-05', faceMatchScore: 0.8, identical: true });
  const payload = JSON.stringify(client.createTransaction.mock.calls[0][0]);
  expect(payload).toContain(Buffer.from('doc').toString('base64'));
  expect(payload).toContain(Buffer.from('self').toString('base64'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest caf-document-verifier`
Expected: FAIL — cannot find './caf-document-verifier'.

- [ ] **Step 3: Write `apps/api/src/verification/caf/caf-document-verifier.ts`**

```ts
import { DocumentVerifierPort, DocumentVerifyInput, DocumentVerifyOutput } from '../document/document-verifier.port';
import { CafClient } from './caf-client';
import { extractDocument } from './caf-mappers';

export class CafDocumentVerifier implements DocumentVerifierPort {
  constructor(private readonly client: CafClient, private readonly scoreScale: number) {}

  async verify(input: DocumentVerifyInput): Promise<DocumentVerifyOutput> {
    const { id } = await this.client.createTransaction({
      services: ['ocr', 'facematch'],
      documentImage: input.documentImage.toString('base64'),
      selfieImage: input.selfieImage.toString('base64'),
    });
    const tx = await this.client.awaitTransaction(id);
    return extractDocument(tx, this.scoreScale);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest caf-document-verifier`
Expected: PASS (1 test).

- [ ] **Step 5: Extend the factory** in `apps/api/src/verification/provider-factory.ts`:
```ts
import { DocumentVerifierPort } from './document/document-verifier.port';
import { MockDocumentVerifier } from './document/mock-document-verifier';
import { CafDocumentVerifier } from './caf/caf-document-verifier';

export function buildDocumentVerifier(cfg: ProviderConfig): DocumentVerifierPort {
  if (cfg.docKind === 'mock') {
    return new MockDocumentVerifier({ birthDate: '1990-01-01', faceMatchScore: 0.99, identical: true });
  }
  if (!cfg.caf) throw new Error('CAF config missing for docKind=caf');
  return new CafDocumentVerifier(new CafClient(cfg.caf), cfg.caf.scoreScale);
}
```
Add a test to `provider-factory.spec.ts`:
```ts
import { buildDocumentVerifier } from './provider-factory';
import { MockDocumentVerifier } from './document/mock-document-verifier';

test('returns the mock document verifier by default', () => {
  expect(buildDocumentVerifier({ ageKind: 'mock', docKind: 'mock' })).toBeInstanceOf(MockDocumentVerifier);
});
```

- [ ] **Step 6: Run + commit**

Run: `npx jest caf-document-verifier provider-factory`
Expected: PASS.
```bash
git add apps/api/src/verification/caf/caf-document-verifier.ts apps/api/src/verification/caf/caf-document-verifier.spec.ts apps/api/src/verification/provider-factory.ts apps/api/src/verification/provider-factory.spec.ts
git commit -m "feat(caf): CafDocumentVerifier + factory selection"
```

---

## Task B4: DocumentSession entity + migration 0003

**Files:**
- Create: `apps/api/src/session/document-session.entity.ts`, `apps/api/src/db/migrations/0003-document-session.ts`
- Modify: `apps/api/src/db/data-source.ts`, `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/session/document-session.entity.ts`**

```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('document_sessions')
export class DocumentSession {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'transaction_id', type: 'uuid' }) transactionId!: string;
  @Column({ name: 'session_token' }) sessionToken!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
```

- [ ] **Step 2: Write `apps/api/src/db/migrations/0003-document-session.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class DocumentSession1717632000003 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE document_sessions (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        transaction_id uuid NOT NULL,
        session_token text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`ALTER TABLE document_sessions ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE document_sessions FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY document_sessions_isolation ON document_sessions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE document_sessions`);
  }
}
```

- [ ] **Step 3: Register the entity** in `apps/api/src/db/data-source.ts` and `apps/api/src/app.module.ts` (add `DocumentSession` to both `entities` arrays, with imports).

- [ ] **Step 4: Verify build**

Run: `npx tsc -b apps/api`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/session/document-session.entity.ts apps/api/src/db/migrations/0003-document-session.ts apps/api/src/db/data-source.ts apps/api/src/app.module.ts
git commit -m "feat(db): document_sessions table + RLS (migration 0003)"
```

---

## Task B5: Webhook payload + issue document session on documento_requerido

**Files:**
- Modify: `packages/sdk-types/src/index.ts` (add optional `document_session_token`)
- Modify: `apps/api/src/verification/verification.processor.ts`
- Modify: `apps/api/src/verification/verification.service.ts`

- [ ] **Step 1: Extend the webhook payload type**

In `packages/sdk-types/src/index.ts`, change `WebhookPayload` to add an optional field:
```ts
export interface WebhookPayload {
  transaction_id: string;
  status: VerificationStatus;
  is_over_18: boolean;
  document_session_token?: string;
}
```

- [ ] **Step 2: Write the failing test (processor issues a document session)**

Append to `apps/api/src/verification/verification.processor.spec.ts`:
```ts
test('on documento_requerido it persists a document session and adds the token to the webhook', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), Buffer.alloc(32, 9));
  await store.put('txdr', serializeFrame(enc), 300);
  // service returns documento_requerido and records nothing extra
  const service = { verify: jest.fn(async () => ({ transaction_id: 'txdr', status: 'documento_requerido', is_over_18: false })) };
  const docSessions: any[] = [];
  const ds = fakeDataSource();
  ds.manager.save = jest.fn(async (_e: any, row: any) => { docSessions.push(row); return row; });
  const once = freshOnce();
  const proc = new VerificationProcessor(store, ds as any, service as any, once as any, Buffer.alloc(32, 9));
  await proc.process({ transactionId: 'txdr', tenantId: 'ten1', frameRef: 'txdr', rawIp: '1.2.3.4' });
  expect(docSessions).toHaveLength(1);
  expect(docSessions[0].transactionId).toBe('txdr');
});
```
(Adjust `fakeDataSource()` in that spec to expose a `manager.save` jest.fn and to return it from `createQueryRunner().manager` as well, so the processor can persist within the scoped runner.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest verification.processor`
Expected: FAIL — no document session persisted.

- [ ] **Step 4: Implement in `verification.processor.ts`**

After `service.verify(...)` returns inside the scoped runner, if `payload.status === 'documento_requerido'`, create + persist a `DocumentSession` and attach its token. Concretely, change the scoped block to capture the payload and, when needed, persist a session and dispatch a follow-up webhook field. Since the webhook is dispatched inside `service.verify`, move the document-session creation BEFORE the verify call is not possible (status is known after). Instead, have `verification.service.verify` accept an optional `onBeforeWebhook` hook OR return the payload and let the processor own the webhook. The minimal change: pass an optional `documentSessionToken` provider.

Use this concrete approach — add to `VerifyArgs` an optional callback `issueDocumentSession?: () => Promise<string>`; in `verify`, when `status === 'documento_requerido'` and the callback is set, call it and set `payload.document_session_token` before `webhook.dispatch`:
```ts
// in verification.service.ts verify(), after computing `status` and building `payload`:
      if (status === 'documento_requerido' && args.issueDocumentSession) {
        payload.document_session_token = await args.issueDocumentSession();
      }
```
And add `issueDocumentSession?: () => Promise<string>;` to the `VerifyArgs` interface (and `import { ... }` not needed).
Then in the processor's scoped block, pass:
```ts
          issueDocumentSession: async () => {
            const token = randomBytes(24).toString('hex');
            await qr.manager.save(DocumentSession, {
              id: randomUUID(),
              tenantId: job.tenantId,
              transactionId: job.transactionId,
              sessionToken: token,
              createdAt: new Date(),
            });
            return token;
          },
```
Add imports to the processor: `import { randomUUID, randomBytes } from 'crypto';` and `import { DocumentSession } from '../session/document-session.entity';`.

- [ ] **Step 5: Run the suite**

Run: `npx jest verification.processor verification.service && npx tsc -b apps/api`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-types/src/index.ts apps/api/src/verification/verification.service.ts apps/api/src/verification/verification.processor.ts apps/api/src/verification/verification.processor.spec.ts
git commit -m "feat(verification): issue single-use document session on documento_requerido"
```

---

## Task B6: Document job contract + POST /verify/document

**Files:**
- Create: `apps/api/src/queue/document-job.ts` (+ test), `apps/api/src/verification/document.controller.ts`
- Modify: `apps/api/src/verification/verification.module.ts`

- [ ] **Step 1: Write the failing test (job builder)**

`apps/api/src/queue/document-job.spec.ts`
```ts
import { buildDocumentJob, DOCUMENT_QUEUE_NAME } from './document-job';

test('builds a document job with both image refs', () => {
  const job = buildDocumentJob({ transactionId: 't1', tenantId: 'ten1', documentRef: 't1:doc', selfieRef: 't1:self', rawIp: '1.2.3.4' });
  expect(job).toEqual({ transactionId: 't1', tenantId: 'ten1', documentRef: 't1:doc', selfieRef: 't1:self', rawIp: '1.2.3.4' });
  expect(DOCUMENT_QUEUE_NAME).toBe('document-verification');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest document-job`
Expected: FAIL — cannot find './document-job'.

- [ ] **Step 3: Write `apps/api/src/queue/document-job.ts`**

```ts
export const DOCUMENT_QUEUE_NAME = 'document-verification';

export interface DocumentJob {
  transactionId: string;
  tenantId: string;
  documentRef: string;
  selfieRef: string;
  rawIp: string;
}

export function buildDocumentJob(args: DocumentJob): DocumentJob {
  return {
    transactionId: args.transactionId,
    tenantId: args.tenantId,
    documentRef: args.documentRef,
    selfieRef: args.selfieRef,
    rawIp: args.rawIp,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest document-job`
Expected: PASS (1 test).

- [ ] **Step 5: Write `apps/api/src/verification/document.controller.ts`**

```ts
import { Body, Controller, Post, Req, HttpCode, BadRequestException, UseGuards, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { DocumentSession } from '../session/document-session.entity';
import { serializeFrame } from '../storage/frame-codec';
import { FRAME_STORE, FrameStorePort } from '../storage/frame-store.port';
import { DocumentQueue } from '../queue/document.queue';
import { buildDocumentJob } from '../queue/document-job';
import { RateLimitGuard } from '../ratelimit/rate-limit.guard';

interface Img { iv: string; tag: string; ciphertext: string; }
interface DocBody { document_session_token: string; document: Img; selfie: Img; }

function toEncrypted(i: Img) {
  return { iv: Buffer.from(i.iv, 'base64'), tag: Buffer.from(i.tag, 'base64'), ciphertext: Buffer.from(i.ciphertext, 'base64') };
}
function validImg(i: any): i is Img {
  return i && typeof i.iv === 'string' && i.iv && typeof i.tag === 'string' && i.tag && typeof i.ciphertext === 'string' && i.ciphertext;
}

@Controller('verify/document')
@UseGuards(RateLimitGuard)
export class DocumentController {
  constructor(
    @InjectRepository(DocumentSession) private readonly sessions: Repository<DocumentSession>,
    @Inject(FRAME_STORE) private readonly store: FrameStorePort,
    private readonly queue: DocumentQueue,
  ) {}

  @Post()
  @HttpCode(202)
  async submit(@Body() body: DocBody, @Req() req: any) {
    if (!body?.document_session_token || typeof body.document_session_token !== 'string') {
      throw new BadRequestException('document_session_token is required');
    }
    if (!validImg(body.document) || !validImg(body.selfie)) {
      throw new BadRequestException('document and selfie images are required (base64 iv/tag/ciphertext)');
    }
    // Atomic single-use consumption of the document session token (replay-safe).
    const consumed = await this.sessions.createQueryBuilder()
      .delete().from(DocumentSession)
      .where('session_token = :t', { t: body.document_session_token })
      .returning('*').execute();
    const row = consumed.raw?.[0] as { tenant_id: string; transaction_id: string; created_at: string | Date } | undefined;
    if (!row) throw new BadRequestException('invalid document_session_token');
    const SESSION_TTL_MS = Number(process.env.SESSION_TTL_SECONDS ?? 900) * 1000;
    if (Date.now() - new Date(row.created_at).getTime() > SESSION_TTL_MS) {
      throw new BadRequestException('document session expired');
    }
    const transactionId = row.transaction_id;
    const documentRef = `${transactionId}:doc`;
    const selfieRef = `${transactionId}:self`;
    const ttl = Number(process.env.FRAME_TTL_SECONDS ?? 300);
    await this.store.put(documentRef, serializeFrame(toEncrypted(body.document)), ttl);
    await this.store.put(selfieRef, serializeFrame(toEncrypted(body.selfie)), ttl);
    await this.queue.enqueue(buildDocumentJob({ transactionId, tenantId: row.tenant_id, documentRef, selfieRef, rawIp: req.ip ?? '' }));
    return { transaction_id: transactionId, status: 'processando' };
  }
}
```

- [ ] **Step 6: Verify build (module wiring + DocumentQueue come in Task B7; run after that)**

Note: `DocumentQueue` is created in Task B7. Implement B7 next, then `npx tsc -b apps/api`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/queue/document-job.ts apps/api/src/queue/document-job.spec.ts apps/api/src/verification/document.controller.ts
git commit -m "feat(document): document job contract + POST /verify/document"
```

---

## Task B7: Document queue + processor + worker + module wiring

**Files:**
- Create: `apps/api/src/queue/document.queue.ts`, `apps/api/src/verification/document/document.processor.ts` (+ test)
- Modify: `apps/api/src/verification/verification.module.ts`, `apps/api/src/worker.ts`

- [ ] **Step 1: Write `apps/api/src/queue/document.queue.ts`**

```ts
import { Queue } from 'bullmq';
import { DocumentJob, DOCUMENT_QUEUE_NAME } from './document-job';

export class DocumentQueue {
  constructor(private readonly queue: Queue) {}
  async enqueue(job: DocumentJob): Promise<void> {
    await this.queue.add(DOCUMENT_QUEUE_NAME, job, {
      jobId: `doc:${job.transactionId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
```

- [ ] **Step 2: Write the failing processor test**

`apps/api/src/verification/document/document.processor.spec.ts`
```ts
import { DocumentProcessor } from './document.processor';
import { MemoryFrameStore } from '../../storage/memory-frame-store';
import { serializeFrame } from '../../storage/frame-codec';
import { encryptFrame } from '../crypto.util';

const key = Buffer.alloc(32, 9);

function deps(verifyOut: any) {
  const tenant = { id: 'ten1', webhookUrl: 'http://hook', webhookSecret: 's' };
  const manager = { findOneOrFail: jest.fn(async () => tenant) };
  const qr = { connect: jest.fn(async () => {}), query: jest.fn(async () => {}), manager, release: jest.fn(async () => {}) };
  const dataSource = { createQueryRunner: () => qr };
  const verifier = { verify: jest.fn(async () => verifyOut) };
  const audit = { record: jest.fn(async () => {}) };
  const webhook = { dispatch: jest.fn(async () => {}) };
  const once = { acquire: jest.fn(async () => true) };
  return { qr, dataSource, verifier, audit, webhook, once };
}

test('verifies a document, decides aprovado, dispatches webhook, deletes both images', async () => {
  const store = new MemoryFrameStore(() => 1000);
  await store.put('t1:doc', serializeFrame(encryptFrame(Buffer.from('doc'), key)), 300);
  await store.put('t1:self', serializeFrame(encryptFrame(Buffer.from('self'), key)), 300);
  const d = deps({ birthDate: '1990-01-01', faceMatchScore: 0.95, identical: true });
  const proc = new DocumentProcessor(store, d.dataSource as any, d.verifier as any, d.audit as any, d.webhook as any, d.once as any, key, { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 });
  await proc.process({ transactionId: 't1', tenantId: 'ten1', documentRef: 't1:doc', selfieRef: 't1:self', rawIp: '1.2.3.4' });
  expect(d.webhook.dispatch).toHaveBeenCalledWith('http://hook', 's', expect.objectContaining({ transaction_id: 't1', status: 'aprovado', is_over_18: true }));
  expect(d.audit.record).toHaveBeenCalledTimes(1);
  expect(await store.get('t1:doc')).toBeNull();
  expect(await store.get('t1:self')).toBeNull();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest document.processor`
Expected: FAIL — cannot find './document.processor'.

- [ ] **Step 4: Write `apps/api/src/verification/document/document.processor.ts`**

```ts
import { DataSource } from 'typeorm';
import { DecisionConfig, WebhookPayload } from '@eca/sdk-types';
import { Tenant } from '../../tenant/tenant.entity';
import { FrameStorePort } from '../../storage/frame-store.port';
import { deserializeFrame } from '../../storage/frame-codec';
import { decryptFrame, zero } from '../crypto.util';
import { decryptSecret } from '../../tenant/secret-crypto';
import { DocumentVerifierPort } from './document-verifier.port';
import { ageFromBirthDate, decideDocument } from './document-decision';
import { isOver18 } from '../decision';
import { AuditService } from '../../audit/audit.service';
import { WebhookService } from '../../webhook/webhook.service';
import { OnceGuard } from '../../queue/once-guard';
import { DocumentJob } from '../../queue/document-job';

export class DocumentProcessor {
  constructor(
    private readonly store: FrameStorePort,
    private readonly dataSource: DataSource,
    private readonly verifier: DocumentVerifierPort,
    private readonly audit: AuditService,
    private readonly webhook: WebhookService,
    private readonly once: OnceGuard,
    private readonly key: Buffer,
    private readonly cfg: DecisionConfig,
    private readonly onceTtlMs: number = 24 * 60 * 60 * 1000,
  ) {}

  async process(job: DocumentJob): Promise<void> {
    let docFrame = Buffer.alloc(0);
    let selfieFrame = Buffer.alloc(0);
    try {
      const docBytes = await this.store.get(job.documentRef);
      const selfieBytes = await this.store.get(job.selfieRef);
      if (!docBytes || !selfieBytes) throw new Error(`document images for ${job.transactionId} expired or missing`);
      if (!(await this.once.acquire(`doc:${job.transactionId}`, this.onceTtlMs))) return;

      docFrame = decryptFrame(deserializeFrame(docBytes), this.key);
      selfieFrame = decryptFrame(deserializeFrame(selfieBytes), this.key);
      const out = await this.verifier.verify({ documentImage: docFrame, selfieImage: selfieFrame });
      const ageFromDoc = out.birthDate ? ageFromBirthDate(out.birthDate, new Date()) : null;
      const status = decideDocument({ ageFromDoc, faceMatchScore: out.faceMatchScore, identical: out.identical }, this.cfg.cutoffAge);
      const payload: WebhookPayload = { transaction_id: job.transactionId, status, is_over_18: isOver18(status) };

      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      try {
        await qr.query(`SELECT set_config('app.tenant_id', $1, false)`, [job.tenantId]);
        const tenant = await qr.manager.findOneOrFail(Tenant, { where: { id: job.tenantId } });
        await this.audit.record({ transactionId: job.transactionId, tenantId: job.tenantId, rawIp: job.rawIp, status, now: new Date() }, qr.manager);
        await this.webhook.dispatch(tenant.webhookUrl, decryptSecret(tenant.webhookSecret, this.key), payload);
      } finally {
        await qr.release();
      }
    } finally {
      zero(docFrame);
      zero(selfieFrame);
      await this.store.delete(job.documentRef);
      await this.store.delete(job.selfieRef);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest document.processor`
Expected: PASS (1 test).

- [ ] **Step 6: Wire the module + worker**

In `apps/api/src/verification/verification.module.ts`: register `DocumentController`, provide `DocumentQueue` (new `Queue(DOCUMENT_QUEUE_NAME, { connection })`), and add `TypeOrmModule.forFeature([DocumentSession])`. In `apps/api/src/worker.ts`: build a second BullMQ `Worker` on `DOCUMENT_QUEUE_NAME` that calls a `DocumentProcessor` constructed with `buildDocumentVerifier(loadProviderConfig(process.env))`, `AppDataSource`, `audit`, `webhook`, `once`, `key`, and `loadDecisionConfig(process.env)`. Register the same graceful-shutdown handler for the second worker.

- [ ] **Step 7: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/queue/document.queue.ts apps/api/src/verification/document/document.processor.ts apps/api/src/verification/document/document.processor.spec.ts apps/api/src/verification/verification.module.ts apps/api/src/worker.ts
git commit -m "feat(document): document queue + processor + worker wiring"
```

---

## Task B8: Plugin document-mode capture

**Files:**
- Create: `packages/plugin/src/document.ts`
- Test: `packages/plugin/src/document.spec.ts`

> Browser capture itself is not unit-tested; the payload builder is. The tenant re-mounts this in document mode using the `document_session_token` their server received in the `documento_requerido` webhook.

- [ ] **Step 1: Write the failing test**

`packages/plugin/src/document.spec.ts`
```ts
import { buildDocumentPayload } from './document';

test('packs both encrypted images with the document session token', () => {
  const img = { iv: Buffer.from([1]), tag: Buffer.from([2]), ciphertext: Buffer.from([3]) };
  const payload = buildDocumentPayload('doc-token', img, img);
  expect(payload.document_session_token).toBe('doc-token');
  expect(payload.document.iv).toBe(Buffer.from([1]).toString('base64'));
  expect(payload.selfie.ciphertext).toBe(Buffer.from([3]).toString('base64'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest document.spec`
Expected: FAIL — cannot find './document'.

- [ ] **Step 3: Write `packages/plugin/src/document.ts`**

```ts
import { RawEncryptedFrame } from './payload';

export function buildDocumentPayload(token: string, document: RawEncryptedFrame, selfie: RawEncryptedFrame) {
  const enc = (f: RawEncryptedFrame) => ({
    iv: f.iv.toString('base64'),
    tag: f.tag.toString('base64'),
    ciphertext: f.ciphertext.toString('base64'),
  });
  return { document_session_token: token, document: enc(document), selfie: enc(selfie) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest document.spec`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/document.ts packages/plugin/src/document.spec.ts
git commit -m "feat(plugin): document-mode payload builder"
```

---

## Task B9: Document flow smoke (manual)

**Files:**
- Create: `apps/api/test/document-smoke.md`

- [ ] **Step 1: Write `apps/api/test/document-smoke.md`**

````markdown
# Document flow smoke (requires infra + CAF sandbox or mock providers)

With `AGE_PROVIDER_KIND=mock` and a forced grey-zone age (temporarily set the MockAgeProvider to `estimatedAge` inside the margin, e.g. 19), OR with real CAF sandbox credentials:

1. Run migrations 0001+0002+0003, start API + both workers.
2. Create a session and POST /verify with a frame → 202; the worker resolves `documento_requerido` and the tenant webhook now includes `document_session_token`.
3. POST /verify/document with that token + a `document` and `selfie` (base64 iv/tag/ciphertext) → 202.
4. The document worker logs completion; the tenant receives a FINAL webhook `aprovado` or `reprovado`.
5. Confirm both image objects are deleted from the bucket after processing.
6. Replay the same `document_session_token` → 400 invalid (single-use).
````

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest`
Expected: all suites green, including the new caf/document/provider-factory suites.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/document-smoke.md
git commit -m "test(document): document flow smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage:** "#2 motor de IA real" → Part A (CafClient + CafAgeProvider + factory, Tasks A1–A5); "calibração da margem etária" → uses existing `DecisionConfig` (cutoff/margin) with `ageRangeLow` as the conservative input (Task A2). "Incluir documento (OCR + facematch)" → Part B (decision B1, ports/mappers B2, CafDocumentVerifier B3, session/migration B4, continuation B5, endpoint B6, queue/processor/worker B7, plugin B8). Privacy-by-design preserved: document images are encrypted in transit, stored only transiently, decrypted in memory in the worker, zeroed in `finally`, and physically deleted (Task B7).
- **Type consistency:** `AgeProviderResult` (existing) is produced by `extractAgeLiveness`/`CafAgeProvider`. `DocumentVerifyOutput` (B2) → consumed by `extractDocument`, `CafDocumentVerifier`, and the `DocumentProcessor`, which maps it through `decideDocument(DocumentResult,...)` — note `DocumentVerifyOutput.birthDate` is converted to `DocumentResult.ageFromDoc` via `ageFromBirthDate` before `decideDocument`. `WebhookPayload.document_session_token?` (B5) is set by `verification.service` and consumed by the plugin/tenant. `DecisionConfig` reused for `cutoffAge`. `CafConfig`/`ProviderConfig` from Task A1 used by the factory and both CAF adapters.
- **No placeholders:** every code step has complete code. The two CAF unknowns (image encoding; score scale) are concrete decisions (base64-in-JSON; `CAF_SCORE_SCALE`), explicitly flagged for sandbox confirmation — not deferred work.
- **Deferred (needs credentials):** live CAF calls (Tasks rely on injected fake client/fetch for tests); the smoke (B9) and any `migration:run` for 0003 require infra and, for `caf` mode, sandbox credentials.
- **Execution note:** Part A (A1–A5) is independently shippable; Part B (B1–B9) can be a second review batch.
```
