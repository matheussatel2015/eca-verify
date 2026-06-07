import { buildConsentRecord } from './consent-record.builder';

test('builds a consent record with masked ip and no biometrics', () => {
  const rec = buildConsentRecord({
    id: 'c1', tenantId: 'ten1', userHash: 'uh_abc', policyVersion: '2026-06-01',
    scope: 'age_verification', rawIp: '203.0.113.45', now: new Date('2026-06-07T00:00:00Z'),
  });
  expect(rec).toMatchObject({
    id: 'c1', tenantId: 'ten1', userHash: 'uh_abc', policyVersion: '2026-06-01', scope: 'age_verification',
  });
  expect(rec.maskedIp).toMatch(/203\.0\.113\.0|203\.0\.113\.x|\*/); // masked, not the raw last octet
  expect(rec.maskedIp).not.toBe('203.0.113.45');
  expect(Object.keys(rec)).not.toContain('frame');
  expect(rec.createdAt).toBeInstanceOf(Date);
});

test('defaults the scope to age_verification', () => {
  const rec = buildConsentRecord({
    id: 'c2', tenantId: 'ten1', userHash: 'uh', policyVersion: 'v1', rawIp: '1.2.3.4', now: new Date(),
  });
  expect(rec.scope).toBe('age_verification');
});
