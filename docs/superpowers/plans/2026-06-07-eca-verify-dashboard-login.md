# ECA Verify — #3b Login do Dashboard (email/senha) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tenant dashboard a real email/password login (separate from the programmatic API key): a tenant admin provisions dashboard users via an API-key-authenticated endpoint, those users log in to get a short-lived JWT, and the dashboard data endpoints accept that JWT (or the API key) — so humans don't paste API keys.

**Architecture:** `dashboard_users` (tenant-scoped, email unique, scrypt password hash). `DashboardAuthService` provisions users, verifies login, and issues/verifies an **HS256 JWT** (via `jose`, signed with `DASHBOARD_JWT_SECRET`, ~1h). A single `DashboardAuthGuard` accepts EITHER a dashboard JWT (3-part bearer → verify → tenant + user) OR an existing API key (→ `ApiKeyService.resolveTenant`), setting `req.tenant`. It guards `/dashboard/stats`, `/dashboard/audit`, and `/auth/me`. `POST /auth/users` (API-key-guarded) provisions; `POST /auth/login` issues a token. The dashboard page gains a small login form that stores the token and uses it for data calls.

**Tech Stack:** Builds on the dashboard (#3) + the existing `ApiKeyService`/`TenantModule`, `config.ts`, `jose` (already a dep), and Node's built-in `scrypt` (no new dependency).

> **Decisions:** session = **JWT Bearer HS256, short-lived**; provisioning = **`POST /auth/users` authenticated by the tenant API key**. `dashboard_users` is an auth/root table (NO RLS — login looks up by email globally); `eca_app` has DML grant. Password hashing uses Node `scrypt` (built-in).

---

## File Structure

```
apps/api/src/auth/
├── password.ts                 # scrypt hash/verify (pure, TDD)
├── dashboard-user.entity.ts    # dashboard_users
├── dashboard-auth.service.ts   # createUser/login/issueToken/verifyToken (TDD)
├── dashboard-auth.guard.ts     # JWT-or-API-key guard (TDD the branch helper)
├── auth.controller.ts          # POST /auth/users, POST /auth/login, GET /auth/me
└── auth.module.ts
apps/api/src/config.ts          # MOD: DASHBOARD_JWT_SECRET / TTL
apps/api/src/db/migrations/0011-dashboard-users.ts   # NEW
apps/api/src/dashboard/dashboard.controller.ts       # MOD: use DashboardAuthGuard on stats/audit
apps/api/src/dashboard/dashboard.page.ts             # MOD: login form (additive, keep redesign)
apps/api/src/app.module.ts      # MOD: import AuthModule
.env.example                    # MOD
apps/api/test/dashboard-login-smoke.md   # NEW
```

---

## Task 1: Password hashing (scrypt)

**Files:**
- Create: `apps/api/src/auth/password.ts`
- Test: `apps/api/src/auth/password.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/password.spec.ts`
```ts
import { hashPassword, verifyPassword } from './password';

test('hash is salted (not the plaintext) and verifies', () => {
  const h = hashPassword('s3nha-forte');
  expect(h).not.toContain('s3nha-forte');
  expect(h).toContain(':');
  expect(verifyPassword('s3nha-forte', h)).toBe(true);
});

test('verify rejects the wrong password', () => {
  expect(verifyPassword('errada', hashPassword('certa'))).toBe(false);
});

test('two hashes of the same password differ (random salt)', () => {
  expect(hashPassword('x')).not.toBe(hashPassword('x'));
});

test('verify is false for a malformed stored value', () => {
  expect(verifyPassword('x', 'garbage')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest auth/password`
Expected: FAIL — cannot find './password'.

- [ ] **Step 3: Write `apps/api/src/auth/password.ts`**

```ts
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, KEYLEN);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored ?? '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  const dk = scryptSync(password, Buffer.from(saltHex, 'hex'), KEYLEN);
  return timingSafeEqual(expected, dk);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest auth/password`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/password.ts apps/api/src/auth/password.spec.ts
git commit -m "feat(auth): scrypt password hashing"
```

---

## Task 2: dashboard_users entity + migration 0011

**Files:**
- Create: `apps/api/src/auth/dashboard-user.entity.ts`, `apps/api/src/db/migrations/0011-dashboard-users.ts`
- Modify: `apps/api/src/db/data-source.ts`, `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/auth/dashboard-user.entity.ts`**

```ts
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('dashboard_users')
export class DashboardUser {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Index({ unique: true })
  @Column() email!: string;
  @Column({ name: 'password_hash' }) passwordHash!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
```

- [ ] **Step 2: Write `apps/api/src/db/migrations/0011-dashboard-users.ts`**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class DashboardUsers1717632000011 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE dashboard_users (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_dashboard_users_tenant ON dashboard_users (tenant_id)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE dashboard_users`);
  }
}
```
(No RLS: login looks up by email across tenants; `eca_app` already has DML grant via the default-privileges from migration 0009.)

- [ ] **Step 3: Register `DashboardUser`** in `apps/api/src/db/data-source.ts` and `apps/api/src/app.module.ts` (both `entities` arrays + imports).

- [ ] **Step 4: Verify build**

Run: `npx tsc -b apps/api`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/dashboard-user.entity.ts apps/api/src/db/migrations/0011-dashboard-users.ts apps/api/src/db/data-source.ts apps/api/src/app.module.ts
git commit -m "feat(auth): dashboard_users table (migration 0011)"
```

---

## Task 3: DashboardAuthService + config

**Files:**
- Modify: `apps/api/src/config.ts`, `.env.example`
- Create: `apps/api/src/auth/dashboard-auth.service.ts`
- Test: `apps/api/src/auth/dashboard-auth.service.spec.ts`

- [ ] **Step 1: Add config to `apps/api/src/config.ts`**

```ts
export function dashboardJwtSecret(env: NodeJS.ProcessEnv): string {
  return env.DASHBOARD_JWT_SECRET ?? 'dev-dashboard-secret-change-me';
}
export function dashboardJwtTtl(env: NodeJS.ProcessEnv): string {
  return env.DASHBOARD_JWT_TTL ?? '1h';
}
```
In `validateEnv`, add: if `(env.NODE_ENV ?? process.env.NODE_ENV) === 'production'` and `(!env.DASHBOARD_JWT_SECRET || env.DASHBOARD_JWT_SECRET === 'dev-dashboard-secret-change-me')`, throw `'DASHBOARD_JWT_SECRET must be set in production'`.
Append to `.env.example`:
```
DASHBOARD_JWT_SECRET=dev-dashboard-secret-change-me
DASHBOARD_JWT_TTL=1h
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/auth/dashboard-auth.service.spec.ts`
```ts
import { DashboardAuthService } from './dashboard-auth.service';
import { hashPassword } from './password';

const secret = 'test-secret';

function repoWith(user: any) {
  return {
    save: jest.fn(async (_e: any, r: any) => r),
    findOne: jest.fn(async (_e: any, _opts: any) => user),
  };
}

test('createUser persists a hashed user (never the plaintext)', async () => {
  const repo = repoWith(null);
  const svc = new DashboardAuthService(repo as any, secret, '1h');
  const u = await svc.createUser('ten1', 'a@acme.com', 'segredo123');
  expect(repo.save).toHaveBeenCalled();
  const saved = repo.save.mock.calls[0][1];
  expect(saved.email).toBe('a@acme.com');
  expect(saved.passwordHash).not.toContain('segredo123');
  expect(u.email).toBe('a@acme.com');
});

test('login returns the user for the right password, null otherwise', async () => {
  const user = { id: 'u1', tenantId: 'ten1', email: 'a@acme.com', passwordHash: hashPassword('segredo123') };
  const svc = new DashboardAuthService(repoWith(user) as any, secret, '1h');
  expect(await svc.login('a@acme.com', 'segredo123')).toMatchObject({ id: 'u1' });
  expect(await svc.login('a@acme.com', 'errada')).toBeNull();
});

test('login returns null for an unknown email', async () => {
  const svc = new DashboardAuthService(repoWith(null) as any, secret, '1h');
  expect(await svc.login('nobody@x.com', 'x')).toBeNull();
});

test('issueToken + verifyToken round-trips the tenant + user', async () => {
  const svc = new DashboardAuthService(repoWith(null) as any, secret, '1h');
  const token = await svc.issueToken({ id: 'u1', tenantId: 'ten1', email: 'a@acme.com' } as any);
  const claims = await svc.verifyToken(token);
  expect(claims).toEqual({ userId: 'u1', tenantId: 'ten1', email: 'a@acme.com' });
});

test('verifyToken rejects a token signed with a different secret', async () => {
  const a = new DashboardAuthService(repoWith(null) as any, 'secret-a', '1h');
  const b = new DashboardAuthService(repoWith(null) as any, 'secret-b', '1h');
  const token = await a.issueToken({ id: 'u1', tenantId: 'ten1', email: 'a@acme.com' } as any);
  await expect(b.verifyToken(token)).rejects.toBeTruthy();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest dashboard-auth.service`
Expected: FAIL — cannot find './dashboard-auth.service'.

- [ ] **Step 4: Write `apps/api/src/auth/dashboard-auth.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { DashboardUser } from './dashboard-user.entity';
import { hashPassword, verifyPassword } from './password';

export interface DashboardClaims {
  userId: string;
  tenantId: string;
  email: string;
}

@Injectable()
export class DashboardAuthService {
  private readonly key: Uint8Array;
  constructor(
    @InjectRepository(DashboardUser) private readonly users: Repository<DashboardUser>,
    private readonly secret: string,
    private readonly ttl: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async createUser(tenantId: string, email: string, password: string): Promise<DashboardUser> {
    const user: DashboardUser = {
      id: randomUUID(),
      tenantId,
      email: email.toLowerCase(),
      passwordHash: hashPassword(password),
      createdAt: new Date(),
    };
    await this.users.save(DashboardUser, user);
    return user;
  }

  async login(email: string, password: string): Promise<DashboardUser | null> {
    const user = await this.users.findOne(DashboardUser, { where: { email: email.toLowerCase() } });
    if (!user) return null;
    return verifyPassword(password, user.passwordHash) ? user : null;
  }

  async issueToken(user: Pick<DashboardUser, 'id' | 'tenantId' | 'email'>): Promise<string> {
    return new SignJWT({ tenant_id: user.tenantId, email: user.email })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(this.ttl)
      .sign(this.key);
  }

  async verifyToken(token: string): Promise<DashboardClaims> {
    const { payload } = await jwtVerify(token, this.key);
    return { userId: String(payload.sub), tenantId: String(payload.tenant_id), email: String(payload.email) };
  }
}
```
NOTE: `users.save(DashboardUser, user)` / `users.findOne(DashboardUser, ...)` use the manager-style 2-arg form to match the test mocks; if the repository typing rejects the 2-arg form, use `this.users.save(user)` / `this.users.findOne({ where: { email } })` and adjust the test mocks to `save(r)` / `findOne(opts)` accordingly (keep impl and test consistent).

- [ ] **Step 4b: Run test to verify it passes**

Run: `npx jest dashboard-auth.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config.ts .env.example apps/api/src/auth/dashboard-auth.service.ts apps/api/src/auth/dashboard-auth.service.spec.ts
git commit -m "feat(auth): dashboard auth service (scrypt login + HS256 JWT) + config"
```

---

## Task 4: DashboardAuthGuard (JWT or API key)

**Files:**
- Create: `apps/api/src/auth/dashboard-auth.guard.ts`
- Test: `apps/api/src/auth/dashboard-auth.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/auth/dashboard-auth.guard.spec.ts`
```ts
import { looksLikeJwt } from './dashboard-auth.guard';

test('looksLikeJwt true for a 3-part token', () => {
  expect(looksLikeJwt('aaa.bbb.ccc')).toBe(true);
});

test('looksLikeJwt false for an sk_ api key', () => {
  expect(looksLikeJwt('sk_abc123')).toBe(false);
});

test('looksLikeJwt false for empty/garbage', () => {
  expect(looksLikeJwt('')).toBe(false);
  expect(looksLikeJwt('aaa.bbb')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest dashboard-auth.guard`
Expected: FAIL — cannot find './dashboard-auth.guard'.

- [ ] **Step 3: Write `apps/api/src/auth/dashboard-auth.guard.ts`**

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { extractBearer } from '../tenant/api-key.guard';
import { ApiKeyService } from '../tenant/api-key.service';
import { Tenant } from '../tenant/tenant.entity';
import { DashboardAuthService } from './dashboard-auth.service';

/** A JWT has exactly three non-empty dot-separated parts; API keys (sk_...) do not. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

@Injectable()
export class DashboardAuthGuard implements CanActivate {
  constructor(
    private readonly auth: DashboardAuthService,
    private readonly apiKeys: ApiKeyService,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers['authorization']);
    if (!token) throw new UnauthorizedException('missing credentials');

    if (looksLikeJwt(token)) {
      let claims;
      try {
        claims = await this.auth.verifyToken(token);
      } catch {
        throw new UnauthorizedException('invalid session token');
      }
      const tenant = await this.tenants.findOne({ where: { id: claims.tenantId } });
      if (!tenant) throw new UnauthorizedException('tenant not found');
      req.tenant = tenant;
      req.dashboardUser = { id: claims.userId, email: claims.email };
      return true;
    }

    const tenant = await this.apiKeys.resolveTenant(token);
    if (!tenant) throw new UnauthorizedException('invalid api key');
    req.tenant = tenant;
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest dashboard-auth.guard`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/dashboard-auth.guard.ts apps/api/src/auth/dashboard-auth.guard.spec.ts
git commit -m "feat(auth): dashboard guard accepting JWT or API key"
```

---

## Task 5: Auth controller + module + wire guard onto dashboard

**Files:**
- Create: `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/src/dashboard/dashboard.controller.ts`, `apps/api/src/dashboard/dashboard.module.ts`, `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/auth/auth.controller.ts`**

```ts
import { BadRequestException, Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { DashboardAuthService } from './dashboard-auth.service';

interface CreateUserBody { email?: unknown; password?: unknown }
interface LoginBody { email?: unknown; password?: unknown }

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: DashboardAuthService) {}

  // Tenant admin (API key) provisions a dashboard login for their tenant.
  @Post('users')
  @UseGuards(ApiKeyGuard)
  async createUser(@Req() req: any, @Body() body: CreateUserBody) {
    if (typeof body.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) {
      throw new BadRequestException('valid email is required');
    }
    if (typeof body.password !== 'string' || body.password.length < 8) {
      throw new BadRequestException('password must be at least 8 characters');
    }
    const u = await this.auth.createUser(req.tenant.id, body.email, body.password);
    return { id: u.id, email: u.email };
  }

  @Post('login')
  async login(@Body() body: LoginBody) {
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new BadRequestException('email and password are required');
    }
    const user = await this.auth.login(body.email, body.password);
    if (!user) throw new UnauthorizedException('invalid credentials');
    const token = await this.auth.issueToken(user);
    return { token, token_type: 'Bearer' };
  }

  @Get('me')
  @UseGuards(DashboardAuthGuard)
  me(@Req() req: any) {
    return { tenant_id: req.tenant.id, user: req.dashboardUser ?? null };
  }
}
```

- [ ] **Step 2: Write `apps/api/src/auth/auth.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardUser } from './dashboard-user.entity';
import { Tenant } from '../tenant/tenant.entity';
import { TenantModule } from '../tenant/tenant.module';
import { AuthController } from './auth.controller';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { dashboardJwtSecret, dashboardJwtTtl } from '../config';

@Module({
  imports: [TypeOrmModule.forFeature([DashboardUser, Tenant]), TenantModule],
  controllers: [AuthController],
  providers: [
    { provide: DashboardAuthService, inject: [], useFactory: () => undefined as any }, // replaced below
    DashboardAuthGuard,
  ],
  exports: [DashboardAuthService, DashboardAuthGuard],
})
export class AuthModule {}
```
Then replace the `DashboardAuthService` provider with a proper factory that injects the repository and config:
```ts
import { getRepositoryToken } from '@nestjs/typeorm';
// in providers:
    {
      provide: DashboardAuthService,
      inject: [getRepositoryToken(DashboardUser)],
      useFactory: (repo) => new DashboardAuthService(repo, dashboardJwtSecret(process.env), dashboardJwtTtl(process.env)),
    },
    DashboardAuthGuard,
```
(Remove the placeholder line; keep a single correct `DashboardAuthService` provider.)

- [ ] **Step 3: Use `DashboardAuthGuard` on the dashboard data endpoints**

In `apps/api/src/dashboard/dashboard.controller.ts`, replace `@UseGuards(ApiKeyGuard)` on the `stats` and `audit` handlers with `@UseGuards(DashboardAuthGuard)` (import it). Leave `GET /dashboard` (the HTML) public. The guard accepts both a dashboard JWT and an API key, so existing API-key usage keeps working.

- [ ] **Step 4: Wire modules**

`apps/api/src/dashboard/dashboard.module.ts`: add `AuthModule` to `imports` (so `DashboardAuthGuard` resolves). `apps/api/src/app.module.ts`: add `AuthModule` to `imports`.

- [ ] **Step 5: Verify build + suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.module.ts apps/api/src/dashboard/dashboard.controller.ts apps/api/src/dashboard/dashboard.module.ts apps/api/src/app.module.ts
git commit -m "feat(auth): /auth/users + /auth/login + /auth/me; dashboard accepts JWT or API key"
```

---

## Task 6: Dashboard login form + smoke + README

**Files:**
- Modify: `apps/api/src/dashboard/dashboard.page.ts`
- Create: `apps/api/test/dashboard-login-smoke.md`
- Modify: `README.md`

- [ ] **Step 1: Add a login form to `dashboard.page.ts` (additive — preserve the existing redesign, IDs, `esc()`, and the `/dashboard/stats|audit` calls)**

In the header controls, add (alongside the existing API-key field) email + password inputs and an "Entrar" button:
```html
<input id="email" type="email" placeholder="email" autocomplete="username"/>
<input id="pass" type="password" placeholder="senha" autocomplete="current-password"/>
<button id="login">Entrar</button>
```
In the `<script>`, add a module-scoped `let authToken = '';` and change `headers()` so a logged-in token takes precedence over the pasted key:
```js
function headers() {
  const bearer = authToken || document.getElementById('key').value.trim();
  return { Authorization: 'Bearer ' + bearer };
}
async function login() {
  const err = document.getElementById('err'); err.textContent = '';
  try {
    const res = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('pass').value }) });
    if (!res.ok) throw new Error('login ' + res.status);
    authToken = (await res.json()).token;
    await load();
  } catch (e) { err.textContent = 'Falha no login: ' + e.message; }
}
document.getElementById('login').addEventListener('click', login);
```
Keep everything else (renderCards/renderChart/renderRows/esc/load/the API-key field) intact. Style the new inputs/button with the existing classes so the look stays cohesive. Stay within the CSP (inline only).

- [ ] **Step 2: Write `apps/api/test/dashboard-login-smoke.md`**

````markdown
# Dashboard login smoke

1. Provision a dashboard user (tenant admin, API key):
   `curl -s -X POST http://localhost:3000/auth/users -H "Authorization: Bearer <api_key>" -H "Content-Type: application/json" -d '{"email":"op@acme.com","password":"segredo123"}'` → `{id,email}`.
2. Log in: `curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"op@acme.com","password":"segredo123"}'` → `{token, token_type:"Bearer"}`.
3. Use the token on the dashboard data API: `curl -s http://localhost:3000/dashboard/stats -H "Authorization: Bearer <token>"` → the tenant's stats (RLS-scoped).
4. `GET /auth/me` with the token → `{tenant_id, user:{id,email}}`.
5. Wrong password → `POST /auth/login` returns 401. Unknown/short password to `/auth/users` → 400.
6. In the browser, open `http://localhost:3000/dashboard`, type email+senha, click "Entrar" — cards/chart/table load without pasting an API key. (The API-key field still works for programmatic access.)
````

- [ ] **Step 3: Add a README note** (Dashboard section): humans log in at `/dashboard` with email/senha (provisioned via `POST /auth/users` with the API key); programmatic access still uses the API key.

- [ ] **Step 4: Run the full unit suite**

Run: `npx jest`
Expected: all green, including password, dashboard-auth.service, dashboard-auth.guard suites.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dashboard/dashboard.page.ts apps/api/test/dashboard-login-smoke.md README.md
git commit -m "feat(dashboard): email/senha login form (token-or-key) + smoke + README"
```

---

## Self-Review Notes

- **Decisions honored:** session = **HS256 JWT** (jose, `DASHBOARD_JWT_SECRET`, ~1h, `issueToken`/`verifyToken`); provisioning = **`POST /auth/users` API-key-guarded**. `dashboard_users` has no RLS (login is a global email lookup); `eca_app` writes it via the 0009 default grants.
- **Security:** passwords hashed with salted `scrypt` + `timingSafeEqual` verify (no plaintext stored/logged); login returns a generic 401; the dashboard guard accepts a 3-part JWT (verified) OR an API key (resolved), never trusting an unverified token; JWT secret required in production (`validateEnv`); short TTL limits a leaked token. `GET /dashboard` stays public (no data); data endpoints require auth.
- **Backward compatible:** `DashboardAuthGuard` still accepts the existing API key, so programmatic dashboard access and the current page keep working; the login form is additive.
- **Type consistency:** `hashPassword`/`verifyPassword` (Task 1) used by the service; `DashboardUser` (Task 2) by the service/guard/module; `DashboardClaims`/`issueToken`/`verifyToken`/`login`/`createUser` (Task 3) by the controller/guard; `looksLikeJwt` (Task 4) by the guard; `dashboardJwtSecret`/`dashboardJwtTtl` (Task 3) by the module.
- **No new dependency:** `scrypt` is built-in; `jose` already present.
- **DB-dependent:** migration 0011 run + the smoke need infra; all logic is unit-tested (repo mocked, JWT round-trip with a test secret).
- **Follow-ups:** password reset / rotation, login rate-limiting (reuse `RateLimitGuard` on `/auth/login`), and httpOnly-cookie sessions are future hardening.
```
