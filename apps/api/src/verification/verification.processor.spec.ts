import { VerificationProcessor } from './verification.processor';
import { MemoryFrameStore } from '../storage/memory-frame-store';
import { serializeFrame } from '../storage/frame-codec';
import { encryptFrame } from './crypto.util';
import { encryptSecret } from '../tenant/secret-crypto';

const key = Buffer.alloc(32, 7);

function fakeDataSource() {
  const manager = {
    findOneOrFail: jest.fn(async () => ({
      id: 'ten1',
      webhookUrl: 'http://hook',
      webhookSecret: encryptSecret('s', Buffer.alloc(32, 9)),
      requiredAge: 18,
    })),
    save: jest.fn(async (_e: any, row: any) => row),
  };
  const qr = {
    connect: jest.fn(async () => {}),
    query: jest.fn(async () => {}),
    manager,
    release: jest.fn(async () => {}),
  };
  return { createQueryRunner: () => qr, qr, manager };
}

function freshOnce() {
  return { acquire: jest.fn(async () => true) };
}

test('fetches the frame, scopes RLS, verifies, then deletes the frame', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('tx1', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => ({ transaction_id: 'tx1', status: 'aprovado', is_over_18: true })) };
  const ds = fakeDataSource();
  const once = freshOnce();

  const proc = new VerificationProcessor(store, ds as any, service as any, once as any, Buffer.alloc(32, 9));
  await proc.process({ transactionId: 'tx1', tenantId: 'ten1', frameRef: 'tx1', rawIp: '1.2.3.4' });

  expect(ds.qr.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_id'"), ['ten1']);
  expect(service.verify).toHaveBeenCalledTimes(1);
  expect(ds.qr.release).toHaveBeenCalledTimes(1);
  expect(await store.get('tx1')).toBeNull();
});

test('forwards the per-tenant cutoff (requiredAge) to service.verify as effectiveCutoffAge', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('txc', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => ({ transaction_id: 'txc', status: 'aprovado', is_over_18: true })) };
  const ds = fakeDataSource();
  ds.manager.findOneOrFail = jest.fn(async () => ({
    id: 'ten1',
    webhookUrl: 'http://hook',
    webhookSecret: encryptSecret('s', Buffer.alloc(32, 9)),
    requiredAge: 16,
  }));
  const once = freshOnce();

  const proc = new VerificationProcessor(store, ds as any, service as any, once as any, Buffer.alloc(32, 9));
  await proc.process({ transactionId: 'txc', tenantId: 'ten1', frameRef: 'txc', rawIp: '1.2.3.4' });

  expect(service.verify).toHaveBeenCalledWith(expect.objectContaining({ effectiveCutoffAge: 16 }));
});

test('deletes the frame even when verification throws', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('tx2', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => { throw new Error('provider down'); }) };
  const ds = fakeDataSource();
  const once = freshOnce();

  const proc = new VerificationProcessor(store, ds as any, service as any, once as any, Buffer.alloc(32, 9));
  await expect(proc.process({ transactionId: 'tx2', tenantId: 'ten1', frameRef: 'tx2', rawIp: '1.2.3.4' }))
    .rejects.toThrow('provider down');
  expect(ds.qr.release).toHaveBeenCalledTimes(1);
  expect(await store.get('tx2')).toBeNull();
});

test('throws when the frame has expired/missing AND still deletes (best-effort)', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const delSpy = jest.spyOn(store, 'delete');
  const service = { verify: jest.fn() };
  const proc = new VerificationProcessor(store, fakeDataSource() as any, service as any, freshOnce() as any, Buffer.alloc(32, 9));
  await expect(proc.process({ transactionId: 'gone', tenantId: 'ten1', frameRef: 'gone', rawIp: '1.2.3.4' }))
    .rejects.toThrow(/frame/i);
  expect(service.verify).not.toHaveBeenCalled();
  expect(delSpy).toHaveBeenCalledWith('gone');
});

test('on documento_requerido it persists a document session and adds the token to the webhook', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('txdr', serializeFrame(enc), 300);
  // service returns documento_requerido and (like the real service) invokes the callback to mint a token
  const service = {
    verify: jest.fn(async (args: any) => {
      const payload: any = { transaction_id: 'txdr', status: 'documento_requerido', is_over_18: false };
      if (args.issueDocumentSession) payload.document_session_token = await args.issueDocumentSession();
      return payload;
    }),
  };
  const docSessions: any[] = [];
  const ds = fakeDataSource();
  ds.manager.save = jest.fn(async (_e: any, row: any) => { docSessions.push(row); return row; });
  const once = freshOnce();
  const proc = new VerificationProcessor(store, ds as any, service as any, once as any, Buffer.alloc(32, 9));
  await proc.process({ transactionId: 'txdr', tenantId: 'ten1', frameRef: 'txdr', rawIp: '1.2.3.4' });
  expect(docSessions).toHaveLength(1);
  expect(docSessions[0].transactionId).toBe('txdr');
  expect(docSessions[0].sessionToken).toMatch(/^[0-9a-f]{48}$/);
});

test('records a frame discard proof after a successful run', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('txd', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => ({ transaction_id: 'txd', status: 'aprovado', is_over_18: true })) };
  const discard = { record: jest.fn(async () => {}) };
  const proc = new VerificationProcessor(store, fakeDataSource() as any, service as any, freshOnce() as any, Buffer.alloc(32, 9), 24 * 60 * 60 * 1000, discard as any);
  await proc.process({ transactionId: 'txd', tenantId: 'ten1', frameRef: 'txd', rawIp: '1.2.3.4' });
  expect(discard.record).toHaveBeenCalledTimes(1);
  expect(discard.record).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'txd', tenantId: 'ten1', what: 'frame' }));
});

test('skips verification when the transaction was already processed (idempotent retry)', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('dup', serializeFrame(enc), 300);
  const service = { verify: jest.fn() };
  const once = { acquire: jest.fn(async () => false) };
  const proc = new VerificationProcessor(store, fakeDataSource() as any, service as any, once as any, Buffer.alloc(32, 9));
  await proc.process({ transactionId: 'dup', tenantId: 'ten1', frameRef: 'dup', rawIp: '1.2.3.4' });
  expect(service.verify).not.toHaveBeenCalled();
  expect(await store.get('dup')).toBeNull(); // frame still deleted
});
