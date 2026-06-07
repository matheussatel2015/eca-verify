import { importPKCS8, SignJWT, exportJWK, JWK } from 'jose';
import { createPublicKey } from 'crypto';

export interface ProofClaims {
  transaction_id: string;
  tenant_id: string;
  status: string;
  is_over_18: boolean;
  method: string;
}

export class ProofService {
  private readonly pem: string;
  constructor(privateKeyPem: string | undefined, private readonly issuer: string) {
    if (!privateKeyPem) throw new Error('PROOF_PRIVATE_KEY is required to issue verification proofs');
    this.pem = privateKeyPem;
  }

  async sign(claims: ProofClaims): Promise<string> {
    const key = await importPKCS8(this.pem, 'ES256');
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setSubject(claims.transaction_id)
      .sign(key);
  }

  async publicJwk(): Promise<JWK> {
    // Derive the public key from the configured private key (PEM → SPKI → JWK).
    const pub = createPublicKey({ key: this.pem, format: 'pem' });
    const jwk = await exportJWK(pub);
    return { ...jwk, alg: 'ES256', use: 'sig' };
  }
}
