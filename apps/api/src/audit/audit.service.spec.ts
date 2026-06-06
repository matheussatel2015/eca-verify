import { AuditService } from './audit.service';

test('builds a metadata-only record (no biometric fields)', () => {
  const record = AuditService.buildRecord({
    transactionId: 'tx1',
    tenantId: 'ten1',
    rawIp: '200.158.4.27',
    status: 'aprovado',
    now: new Date('2026-06-06T12:00:00Z'),
  });
  expect(record).toEqual({
    id: 'tx1',
    tenantId: 'ten1',
    maskedIp: '200.158.4.0',
    status: 'aprovado',
    createdAt: new Date('2026-06-06T12:00:00Z'),
  });
  // Guard: no biometric/image keys ever leak into the record.
  expect(Object.keys(record)).not.toContain('frame');
  expect(Object.keys(record)).not.toContain('image');
});
