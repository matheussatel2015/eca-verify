# Audit trail + proof smoke (requires infra + a PROOF_PRIVATE_KEY)

Generate a key and set it in .env:
```bash
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt
# put the PEM (one line with \n or multiline) into PROOF_PRIVATE_KEY
```

1. Run migrations (0001–0006), start API + workers, seed a tenant.
2. Run a verification (session → /verify with a mock provider). The final webhook payload now carries a `proof` JWT.
3. Fetch the public keys: `curl -s http://localhost:3000/.well-known/jwks.json` → one EC key (alg ES256).
4. Verify the `proof` JWT offline against that JWK (e.g. jwt.io or a `jose.jwtVerify`) → claims show transaction_id, status, is_over_18, method, iss=eca-verify.
5. `GET /verifications/<txid>/proof` with the tenant API key → re-issues the JWT for that transaction; another tenant's key → 404 (RLS isolation).
6. Inspect the method trail: `psql ... -c "SELECT method, estimated_age, liveness_score, cutoff_age, provider, model_version, decision_reason FROM verification_records LIMIT 5;"` → metadata present, NO biometric columns.
