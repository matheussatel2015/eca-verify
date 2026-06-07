'use strict';

// Fake-CAF stub: a dependency-free Node http server that mimics the subset of
// CAF's transaction API that ECA Verify's CafClient/mappers consume:
//   POST /token            -> { access_token, expires_in }
//   POST /transactions     -> { id }            (remembers requested services per id)
//   GET  /transactions/:id -> a COMPLETED transaction whose services[] match
//                             what caf-mappers.ts expects.
//
// The first GET for an id returns PENDING; the second returns COMPLETED, so the
// app's polling loop (awaitTransaction) is actually exercised.
//
// Configurable via env:
//   PORT          (default 8090)
//   STUB_AGE_LOW  (default 25 -> adult/aprovado; ageRangeHigh = low + 4)
//
// No npm deps on purpose: runs under plain `node server.js`.

const http = require('http');
const { randomUUID } = require('crypto');

const PORT = Number(process.env.PORT || 8090);
const AGE_LOW = Number(process.env.STUB_AGE_LOW || 25);
const AGE_HIGH = AGE_LOW + 4;

// transactionId -> { services: string[], gets: number }
const transactions = new Map();

function log(...args) {
  // eslint-disable-next-line no-console
  console.log('[caf-stub]', ...args);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Build the COMPLETED services[] for an id based on the services it requested.
function buildServices(requested) {
  const services = [];
  if (requested.includes('face_liveness')) {
    services.push({ name: 'face_liveness', status: 'COMPLETED', data: { info: { probability: 95 } } });
  }
  if (requested.includes('face_details')) {
    services.push({ name: 'face_details', status: 'COMPLETED', data: { ageRangeLow: AGE_LOW, ageRangeHigh: AGE_HIGH } });
  }
  if (requested.includes('ocr')) {
    services.push({ name: 'ocr', status: 'COMPLETED', data: { ocr: { birthDate: '1995-05-05' } } });
  }
  if (requested.includes('facematch')) {
    services.push({ name: 'facematch', status: 'COMPLETED', data: { confidence: 92, identical: true } });
  }
  return services;
}

// A PENDING mirror of the requested services (so isTransactionComplete() is false).
function buildPendingServices(requested) {
  return requested.map((name) => ({ name, status: 'PENDING', data: {} }));
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '';
  const method = req.method || 'GET';

  // POST /token
  if (method === 'POST' && url === '/token') {
    log('POST /token');
    return sendJson(res, 200, { access_token: 'stub-token', expires_in: 3600 });
  }

  // POST /transactions
  if (method === 'POST' && url === '/transactions') {
    const body = await readBody(req);
    const requested = Array.isArray(body.services) ? body.services.map(String) : [];
    const id = randomUUID();
    transactions.set(id, { services: requested, gets: 0 });
    log('POST /transactions', { id, services: requested });
    return sendJson(res, 200, { id });
  }

  // GET /transactions/:id
  if (method === 'GET' && url.startsWith('/transactions/')) {
    const id = decodeURIComponent(url.slice('/transactions/'.length));
    const tx = transactions.get(id);
    if (!tx) {
      log('GET /transactions/:id NOT FOUND', { id });
      return sendJson(res, 404, { error: 'transaction not found' });
    }
    tx.gets += 1;
    // First GET -> PENDING (exercise polling); second+ -> COMPLETED.
    if (tx.gets < 2) {
      log('GET /transactions/:id PENDING', { id, attempt: tx.gets });
      return sendJson(res, 200, { status: 'PENDING', services: buildPendingServices(tx.services) });
    }
    log('GET /transactions/:id COMPLETED', { id, attempt: tx.gets, services: tx.services });
    return sendJson(res, 200, { status: 'COMPLETED', services: buildServices(tx.services) });
  }

  // Health probe / anything else.
  if (method === 'GET' && (url === '/' || url === '/health')) {
    return sendJson(res, 200, { status: 'ok', ageLow: AGE_LOW });
  }

  log('UNHANDLED', method, url);
  return sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  log(`listening on :${PORT} (STUB_AGE_LOW=${AGE_LOW}, ageRangeHigh=${AGE_HIGH})`);
});
