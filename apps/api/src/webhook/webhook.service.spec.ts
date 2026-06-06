import { WebhookService } from './webhook.service';
import { verifySignature } from './signature.util';
import { WebhookPayload } from '@eca/sdk-types';

test('sends a signed payload and succeeds on first try', async () => {
  const calls: any[] = [];
  const fetchMock = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return { ok: true, status: 200 } as any;
  });
  const svc = new WebhookService(fetchMock as any, { retries: 2, delayMs: 0 });
  const payload: WebhookPayload = { transaction_id: '1', status: 'aprovado', is_over_18: true };

  await svc.dispatch('http://hook', 'secret', payload);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const sig = calls[0].init.headers['X-Signature'];
  expect(verifySignature(calls[0].init.body, sig, 'secret')).toBe(true);
});

test('retries on failure then throws after exhausting retries', async () => {
  const fetchMock = jest.fn(async () => ({ ok: false, status: 500 } as any));
  const svc = new WebhookService(fetchMock as any, { retries: 2, delayMs: 0 });
  await expect(
    svc.dispatch('http://hook', 'secret', { transaction_id: '1', status: 'reprovado', is_over_18: false }),
  ).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
});
