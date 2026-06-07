import { DashboardAuthService } from './dashboard-auth.service';
import { hashPassword } from './password';

const secret = 'test-secret';

function repoWith(user: any) {
  return {
    save: jest.fn(async (r: any) => r),
    findOne: jest.fn(async (_opts: any) => user),
  };
}

test('createUser persists a hashed user (never the plaintext)', async () => {
  const repo = repoWith(null);
  const svc = new DashboardAuthService(repo as any, secret, '1h');
  const u = await svc.createUser('ten1', 'a@acme.com', 'segredo123');
  expect(repo.save).toHaveBeenCalled();
  const saved = repo.save.mock.calls[0][0];
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
