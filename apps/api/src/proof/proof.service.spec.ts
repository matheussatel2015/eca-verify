import { generateKeyPair, exportPKCS8, jwtVerify, importJWK, decodeProtectedHeader } from 'jose';
import { ProofService } from './proof.service';

test('signs an ES256 JWT that verifies with the public JWK', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const pem = await exportPKCS8(privateKey);
  const svc = new ProofService(pem, 'eca-verify');

  const jwt = await svc.sign({ transaction_id: 'tx1', tenant_id: 'ten1', status: 'aprovado', is_over_18: true, method: 'age_liveness' });
  const jwk = await svc.publicJwk();
  expect(jwk.kty).toBe('EC');

  const { payload } = await jwtVerify(jwt, publicKey, { issuer: 'eca-verify' });
  expect(payload.transaction_id).toBe('tx1');
  expect(payload.is_over_18).toBe(true);
  expect(payload.iss).toBe('eca-verify');

  // Round-trip via the exported public JWK (LOW-2) and assert exp/jti/kid.
  const derived = await importJWK(await svc.publicJwk(), 'ES256');
  const { payload: rt } = await jwtVerify(jwt, derived, { issuer: 'eca-verify' });
  expect(rt.transaction_id).toBe('tx1');
  expect(rt.exp).toBeDefined();
  expect(rt.jti).toBe('tx1');
  expect(decodeProtectedHeader(jwt).kid).toBeDefined();
});

test('throws if no private key is configured', () => {
  expect(() => new ProofService(undefined, 'eca-verify')).toThrow(/PROOF_PRIVATE_KEY/);
});
