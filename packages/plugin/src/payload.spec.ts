import { buildVerifyPayload, buildSessionOpenPayload } from './payload';

test('packs the encrypted frame as base64 with the session token', () => {
  const payload = buildVerifyPayload('sess-token', {
    iv: Buffer.from([1, 2, 3]),
    tag: Buffer.from([4, 5, 6]),
    ciphertext: Buffer.from([7, 8, 9]),
  });
  expect(payload).toEqual({
    session_token: 'sess-token',
    frame: {
      iv: Buffer.from([1, 2, 3]).toString('base64'),
      tag: Buffer.from([4, 5, 6]).toString('base64'),
      ciphertext: Buffer.from([7, 8, 9]).toString('base64'),
    },
  });
});

test('session-open payload carries user_hash, policy_version and explicit consent', () => {
  const p = buildSessionOpenPayload({ userHash: 'uh_abc', policyVersion: '2026-06-01', consentGiven: true });
  expect(p).toEqual({ user_hash: 'uh_abc', policy_version: '2026-06-01', consent: true });
});

test('session-open payload reflects a refused consent', () => {
  const p = buildSessionOpenPayload({ userHash: 'uh', policyVersion: 'v1', consentGiven: false });
  expect(p.consent).toBe(false);
});
