# Document flow smoke (requires infra + CAF sandbox or mock providers)

With `AGE_PROVIDER_KIND=mock` and a forced grey-zone age (temporarily set the MockAgeProvider to `estimatedAge` inside the margin, e.g. 19), OR with real CAF sandbox credentials:

1. Run migrations 0001+0002+0003, start API + both workers.
2. Create a session and POST /verify with a frame → 202; the worker resolves `documento_requerido` and the tenant webhook now includes `document_session_token`.
3. POST /verify/document with that token + a `document` and `selfie` (base64 iv/tag/ciphertext) → 202.
4. The document worker logs completion; the tenant receives a FINAL webhook `aprovado` or `reprovado`.
5. Confirm both image objects are deleted from the bucket after processing.
6. Replay the same `document_session_token` → 400 invalid (single-use).
