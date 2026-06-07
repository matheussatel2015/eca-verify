import { VerificationService } from './verification.service';
import { MockAgeProvider } from './mock-age-provider';
import { encryptFrame } from './crypto.util';
import { VerificationRecordService } from './verification-record.service';
import { DecisionConfig } from '@eca/sdk-types';

const key = Buffer.alloc(32, 7);
const cfg: DecisionConfig = { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 };

function makeService(age: number, liveness: number) {
  const audit = { record: jest.fn(async () => {}) };
  const webhook = { dispatch: jest.fn(async () => {}) };
  const provider = new MockAgeProvider({ estimatedAge: age, livenessScore: liveness });
  const svc = new VerificationService(provider, audit as any, webhook as any, cfg, key, new VerificationRecordService(), null);
  return { svc, audit, webhook };
}

test('approves an adult and dispatches an aprovado webhook', async () => {
  const { svc, audit, webhook } = makeService(30, 0.95);
  const enc = encryptFrame(Buffer.from('frame'), key);
  const result = await svc.verify({
    transactionId: 'tx1', tenantId: 'ten1', rawIp: '1.2.3.4',
    webhookUrl: 'http://hook', webhookSecret: 's', encryptedFrame: enc,
  });
  expect(result.status).toBe('aprovado');
  expect(result.is_over_18).toBe(true);
  expect(audit.record).toHaveBeenCalledTimes(1);
  expect(webhook.dispatch).toHaveBeenCalledWith('http://hook', 's',
    expect.objectContaining({ transaction_id: 'tx1', status: 'aprovado', is_over_18: true }));
});

test('rejects a tampered frame without recording audit or dispatching webhook', async () => {
  const { svc, audit, webhook } = makeService(30, 0.95);
  const enc = encryptFrame(Buffer.from('frame'), key);
  enc.ciphertext[0] ^= 0xff; // tamper: GCM auth tag will no longer verify
  await expect(
    svc.verify({
      transactionId: 'tx3', tenantId: 'ten1', rawIp: '1.2.3.4',
      webhookUrl: 'http://hook', webhookSecret: 's', encryptedFrame: enc,
    }),
  ).rejects.toThrow();
  expect(audit.record).not.toHaveBeenCalled();
  expect(webhook.dispatch).not.toHaveBeenCalled();
});

test('grey-zone result yields documento_requerido', async () => {
  const { svc } = makeService(19, 0.95);
  const enc = encryptFrame(Buffer.from('frame'), key);
  const result = await svc.verify({
    transactionId: 'tx2', tenantId: 'ten1', rawIp: '1.2.3.4',
    webhookUrl: 'http://hook', webhookSecret: 's', encryptedFrame: enc,
  });
  expect(result.status).toBe('documento_requerido');
  expect(result.is_over_18).toBe(false);
});
