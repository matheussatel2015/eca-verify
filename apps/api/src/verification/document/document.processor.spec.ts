import { DocumentProcessor } from './document.processor';
import { MemoryFrameStore } from '../../storage/memory-frame-store';
import { serializeFrame } from '../../storage/frame-codec';
import { encryptFrame } from '../crypto.util';
import { encryptSecret } from '../../tenant/secret-crypto';

const key = Buffer.alloc(32, 9);

function deps(verifyOut: any) {
  const tenant = { id: 'ten1', webhookUrl: 'http://hook', webhookSecret: encryptSecret('s', key) };
  const manager = { findOneOrFail: jest.fn(async () => tenant) };
  const qr = { connect: jest.fn(async () => {}), query: jest.fn(async () => {}), manager, release: jest.fn(async () => {}) };
  const dataSource = { createQueryRunner: () => qr };
  const verifier = { verify: jest.fn(async () => verifyOut) };
  const audit = { record: jest.fn(async () => {}) };
  const webhook = { dispatch: jest.fn(async () => {}) };
  const once = { acquire: jest.fn(async () => true) };
  return { qr, dataSource, verifier, audit, webhook, once };
}

test('verifies a document, decides aprovado, dispatches webhook, deletes both images', async () => {
  const store = new MemoryFrameStore(() => 1000);
  await store.put('t1:doc', serializeFrame(encryptFrame(Buffer.from('doc'), key)), 300);
  await store.put('t1:self', serializeFrame(encryptFrame(Buffer.from('self'), key)), 300);
  const d = deps({ birthDate: '1990-01-01', faceMatchScore: 0.95, identical: true });
  const proc = new DocumentProcessor(store, d.dataSource as any, d.verifier as any, d.audit as any, d.webhook as any, d.once as any, key, { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 });
  await proc.process({ transactionId: 't1', tenantId: 'ten1', documentRef: 't1:doc', selfieRef: 't1:self', rawIp: '1.2.3.4' });
  expect(d.webhook.dispatch).toHaveBeenCalledWith('http://hook', 's', expect.objectContaining({ transaction_id: 't1', status: 'aprovado', is_over_18: true }));
  expect(d.audit.record).toHaveBeenCalledTimes(1);
  expect(await store.get('t1:doc')).toBeNull();
  expect(await store.get('t1:self')).toBeNull();
});
