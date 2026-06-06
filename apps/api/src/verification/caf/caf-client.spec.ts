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
