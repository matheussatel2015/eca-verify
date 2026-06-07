import { importPKCS8, SignJWT, exportJWK, calculateJwkThumbprint, JWK } from 'jose';
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
  constructor(privateKeyPem: string | undefined, private readonly issuer: string, private readonly ttl: string = '3650d') {
    if (!privateKeyPem) throw new Error('PROOF_PRIVATE_KEY is required to issue verification proofs');
    this.pem = privateKeyPem;
  }

  // RFC7638 JWK thumbprint of the public key — used as the JWS `kid`.
  private async kid(): Promise<string> {
    const jwk = await exportJWK(createPublicKey({ key: this.pem, format: 'pem' }));
    return calculateJwkThumbprint(jwk);
  }

  async sign(claims: ProofClaims): Promise<string> {
    const key = await importPKCS8(this.pem, 'ES256');
    const kid = await this.kid();
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid })
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setSubject(claims.transaction_id)
      .setExpirationTime(this.ttl)
      .setJti(claims.transaction_id)
      .sign(key);
  }

  async publicJwk(): Promise<JWK> {
    // Derive the public key from the configured private key (PEM → SPKI → JWK).
    const pub = createPublicKey({ key: this.pem, format: 'pem' });
    const jwk = await exportJWK(pub);
    return { ...jwk, alg: 'ES256', use: 'sig', kid: await calculateJwkThumbprint(jwk) };
  }
}
