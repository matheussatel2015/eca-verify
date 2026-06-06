import { VerificationProcessor } from './verification.processor';
import { MemoryFrameStore } from '../storage/memory-frame-store';
import { serializeFrame } from '../storage/frame-codec';
import { encryptFrame } from './crypto.util';

const key = Buffer.alloc(32, 7);

function tenantRepo() {
  return { findOneOrFail: jest.fn(async () => ({ id: 'ten1', webhookUrl: 'http://hook', webhookSecret: 's' })) };
}

test('fetches the frame, verifies, then deletes the frame', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('tx1', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => ({ transaction_id: 'tx1', status: 'aprovado', is_over_18: true })) };
  const repo = tenantRepo();

  const proc = new VerificationProcessor(store, repo as any, service as any);
  await proc.process({ transactionId: 'tx1', tenantId: 'ten1', frameRef: 'tx1', rawIp: '1.2.3.4' });

  expect(service.verify).toHaveBeenCalledTimes(1);
  expect(await store.get('tx1')).toBeNull(); // physically deleted
});

test('deletes the frame even when verification throws', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const enc = encryptFrame(Buffer.from('frame'), key);
  await store.put('tx2', serializeFrame(enc), 300);
  const service = { verify: jest.fn(async () => { throw new Error('provider down'); }) };
  const repo = tenantRepo();

  const proc = new VerificationProcessor(store, repo as any, service as any);
  await expect(proc.process({ transactionId: 'tx2', tenantId: 'ten1', frameRef: 'tx2', rawIp: '1.2.3.4' }))
    .rejects.toThrow('provider down');
  expect(await store.get('tx2')).toBeNull();
});

test('throws when the frame has expired or is missing', async () => {
  const store = new MemoryFrameStore(() => 1000);
  const service = { verify: jest.fn() };
  const proc = new VerificationProcessor(store, tenantRepo() as any, service as any);
  await expect(proc.process({ transactionId: 'gone', tenantId: 'ten1', frameRef: 'gone', rawIp: '1.2.3.4' }))
    .rejects.toThrow(/frame/i);
  expect(service.verify).not.toHaveBeenCalled();
});
