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
