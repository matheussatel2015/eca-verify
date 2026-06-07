import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';

interface FakeRequest {
  headers: Record<string, string | undefined>;
  tenant?: unknown;
}

function mockContext(req: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function fakeApiKeyService(resolved: unknown): ApiKeyService {
  return {
    resolveTenant: jest.fn().mockResolvedValue(resolved),
  } as unknown as ApiKeyService;
}

describe('ApiKeyGuard.canActivate rejection paths', () => {
  test('missing Authorization header throws Unauthorized', async () => {
    const guard = new ApiKeyGuard(fakeApiKeyService(null));
    const ctx = mockContext({ headers: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  test('unknown key (resolveTenant -> null) throws Unauthorized', async () => {
    const guard = new ApiKeyGuard(fakeApiKeyService(null));
    const ctx = mockContext({ headers: { authorization: 'Bearer sk_unknown' } });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  test('valid key sets req.tenant and returns true', async () => {
    const tenant = { id: 't_1', name: 'Acme' };
    const guard = new ApiKeyGuard(fakeApiKeyService(tenant));
    const req: FakeRequest = { headers: { authorization: 'Bearer sk_valid' } };
    const ctx = mockContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenant).toEqual(tenant);
  });
});
