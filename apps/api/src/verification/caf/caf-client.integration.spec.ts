import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { CafClient } from './caf-client';
import { CafAgeProvider } from './caf-age-provider';
import { CafConfig } from '../../config';

// Integration test: stands up a REAL Node http server returning canned CAF
// responses, points a REAL CafClient (using the global fetch, not a mock) at it,
// and asserts the full createTransaction -> awaitTransaction -> mapping chain
// over an actual HTTP round-trip + JSON parse. This validates fetch/JSON wiring
// beyond the fake-fetch unit tests.

let server: Server;
let baseUrl: string;

// Per-id GET counter so the first GET is PENDING and the second is COMPLETED,
// exercising the client's polling loop over real HTTP.
const getCounts = new Map<string, number>();

function readJson(req: import('http').IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(raw ? JSON.parse(raw) : {});
    });
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = req.url ?? '';
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url === '/token') {
      return send(200, { access_token: 'it-token', expires_in: 3600 });
    }
    if (req.method === 'POST' && url === '/transactions') {
      await readJson(req); // drain body; canned id below
      getCounts.set('tx-it', 0);
      return send(200, { id: 'tx-it' });
    }
    if (req.method === 'GET' && url.startsWith('/transactions/')) {
      const id = url.slice('/transactions/'.length);
      const n = (getCounts.get(id) ?? 0) + 1;
      getCounts.set(id, n);
      if (n < 2) {
        return send(200, {
          status: 'PENDING',
          services: [
            { name: 'face_liveness', status: 'PENDING', data: {} },
            { name: 'face_details', status: 'PENDING', data: {} },
          ],
        });
      }
      return send(200, {
        status: 'COMPLETED',
        services: [
          { name: 'face_liveness', status: 'COMPLETED', data: { info: { probability: 95 } } },
          { name: 'face_details', status: 'COMPLETED', data: { ageRangeLow: 25, ageRangeHigh: 29 } },
        ],
      });
    }
    return send(404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function cfg(): CafConfig {
  return {
    baseUrl,
    clientId: 'it-id',
    clientSecret: 'it-sec',
    scoreScale: 100,
    timeoutMs: 5000,
    pollIntervalMs: 10,
    pollMaxAttempts: 10,
  };
}

test('createTransaction + awaitTransaction over a real HTTP round-trip', async () => {
  const client = new CafClient(cfg()); // real global fetch
  const { id } = await client.createTransaction({ services: ['face_liveness', 'face_details'] });
  expect(id).toBe('tx-it');

  const tx = await client.awaitTransaction(id); // polls: PENDING then COMPLETED
  expect(tx.status).toBe('COMPLETED');
  expect(tx.services).toHaveLength(2);
});

test('CafAgeProvider.analyze maps the real HTTP result to {estimatedAge, livenessScore}', async () => {
  const client = new CafClient(cfg());
  const provider = new CafAgeProvider(client, 100);
  const result = await provider.analyze(Buffer.from('integration-frame-bytes'));
  expect(result.estimatedAge).toBe(25);
  expect(result.livenessScore).toBeCloseTo(0.95);
});
