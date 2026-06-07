import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
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
});

test('throws if no private key is configured', () => {
  expect(() => new ProofService(undefined, 'eca-verify')).toThrow(/PROOF_PRIVATE_KEY/);
});
