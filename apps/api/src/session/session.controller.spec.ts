import { BadRequestException } from '@nestjs/common';
import { SessionController } from './session.controller';

function makeController() {
  const savedRows: any[] = [];
  const mgr = {
    query: jest.fn(async () => {}),
    save: jest.fn(async (_e: any, row: any) => { savedRows.push(row); return row; }),
  };
  const sessions: any = {
    manager: { transaction: jest.fn(async (fn: (m: any) => Promise<void>) => fn(mgr)) },
  };
  const billing: any = { consumeQuota: jest.fn(async () => {}) };
  const consent: any = { saveWith: jest.fn(async () => {}) };
  const controller = new SessionController(sessions, billing, consent);
  return { controller, billing, consent, sessions, mgr, savedRows };
}

const req = { tenant: { id: 'ten1' }, ip: '203.0.113.45', headers: {} };

test('opens a session, returns token + plugin url, and persists session + consent in one tx', async () => {
  const { controller, consent, savedRows } = makeController();
  const out = await controller.create({ user_hash: 'uh_abc', policy_version: '2026-06-01', consent: true }, req as any);
  expect(out.session_token).toMatch(/^[0-9a-f]{48}$/);
  expect(out.plugin_url).toContain(out.session_token);
  expect(consent.saveWith).toHaveBeenCalledTimes(1);
  // both a VerificationSession and a consent record were saved on the same scoped manager
  expect(savedRows.some((r: any) => r.sessionToken)).toBe(true);
});

test('rejects a body carrying PII (assertNoPii unchanged)', async () => {
  const { controller } = makeController();
  await expect(controller.create({ user_hash: 'uh', policy_version: 'v1', consent: true, cpf: '12345678900' }, req as any))
    .rejects.toBeInstanceOf(BadRequestException);
});

test('rejects a missing user_hash', async () => {
  const { controller } = makeController();
  await expect(controller.create({ policy_version: 'v1', consent: true }, req as any))
    .rejects.toThrow(/user_hash/);
});

test('rejects a missing policy_version', async () => {
  const { controller } = makeController();
  await expect(controller.create({ user_hash: 'uh', consent: true }, req as any))
    .rejects.toThrow(/policy_version/);
});

test('rejects when consent is not explicitly true', async () => {
  const { controller } = makeController();
  await expect(controller.create({ user_hash: 'uh', policy_version: 'v1', consent: false }, req as any))
    .rejects.toThrow(/consent/);
  await expect(controller.create({ user_hash: 'uh', policy_version: 'v1' }, req as any))
    .rejects.toThrow(/consent/);
});
