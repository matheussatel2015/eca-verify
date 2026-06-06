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
