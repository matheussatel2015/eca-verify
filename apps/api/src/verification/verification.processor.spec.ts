import { VerificationProcessor } from './verification.processor';
import { MemoryFrameStore } from '../storage/memory-frame-store';
import { serializeFrame } from '../storage/frame-codec';
import { encryptFrame } from './crypto.util';
import { encryptSecret } from '../tenant/secret-crypto';
process.env.APP_ENCRYPTION_KEY = '09'.repeat(32); // 64 hex chars -> Buffer.alloc(32, 9)

const key = Buffer.alloc(32, 7);

function fakeDataSource() {
  const manager = {
    findOneOrFail: jest.fn(async () => ({
      id: 'ten1',
      webhookUrl: 'http://hook',
      webhookSecret: encryptSecret('s', Buffer.alloc(32, 9)),
    })),
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

  const proc = new VerificationProcessor(store, ds as any, service as any, once as any);
  await proc.process({ transactionId: 'tx1', tenantId: 'ten1', frameRef: 'tx1', rawIp: '1.2.3.4' });

  expect(ds.qr.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_id'"), ['ten1']);
  expect(service.verify).toHaveBeenCalledTimes(1);
  expect(ds.qr.release).toHaveBeenCalledTimes(1);
  expect(await store.get('tx1')).toBeNull();
});

test('deletes the frame even when verification throws', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('tx2', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => { throw new Error('provider down'); }) };
  const ds = fakeDataSource();
  const once = freshOnce();

  const proc = new VerificationProcessor(store, ds as any, service as any, once as any);
  await expect(proc.process({ transactionId: 'tx2', tenantId: 'ten1', frameRef: 'tx2', rawIp: '1.2.3.4' }))
    .rejects.toThrow('provider down');
  expect(ds.qr.release).toHaveBeenCalledTimes(1);
  expect(await store.get('tx2')).toBeNull();
});

test('throws when the frame has expired/missing AND still deletes (best-effort)', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const delSpy = jest.spyOn(store, 'delete');
  const service = { verify: jest.fn() };
  const proc = new VerificationProcessor(store, fakeDataSource() as any, service as any, freshOnce() as any);
  await expect(proc.process({ transactionId: 'gone', tenantId: 'ten1', frameRef: 'gone', rawIp: '1.2.3.4' }))
    .rejects.toThrow(/frame/i);
  expect(service.verify).not.toHaveBeenCalled();
  expect(delSpy).toHaveBeenCalledWith('gone');
});

test('skips verification when the transaction was already processed (idempotent retry)', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('dup', serializeFrame(enc), 300);
  const service = { verify: jest.fn() };
  const once = { acquire: jest.fn(async () => false) };
  const proc = new VerificationProcessor(store, fakeDataSource() as any, service as any, once as any);
  await proc.process({ transactionId: 'dup', tenantId: 'ten1', frameRef: 'dup', rawIp: '1.2.3.4' });
  expect(service.verify).not.toHaveBeenCalled();
  expect(await store.get('dup')).toBeNull(); // frame still deleted
});
