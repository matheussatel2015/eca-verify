# Fake-CAF stub

A tiny, dependency-free Node `http` server that mimics the subset of the
[CAF](https://docs.caf.io/) transaction API that ECA Verify's CAF adapter
(`apps/api/src/verification/caf/*`) actually calls. It lets you exercise the
**real** CAF code path (`AGE_PROVIDER_KIND=caf` / `DOC_VERIFIER_KIND=caf`) end to
end without real vendor credentials.

## Endpoints

| Method | Path                 | Response |
|--------|----------------------|----------|
| POST   | `/token`             | `{ "access_token": "stub-token", "expires_in": 3600 }` |
| POST   | `/transactions`      | `{ "id": "<uuid>" }` — remembers the requested `services[]` per id |
| GET    | `/transactions/:id`  | first call → `PENDING`, second+ → `COMPLETED` (exercises the app's polling loop) |
| GET    | `/` or `/health`     | `{ "status": "ok", "ageLow": <STUB_AGE_LOW> }` |

The COMPLETED `services[]` match what `caf-mappers.ts` expects:

- **Age/liveness** (`services: ['face_liveness','face_details']`):
  - `face_liveness` → `data.info.probability = 95` (→ `livenessScore = 0.95` with `CAF_SCORE_SCALE=100`)
  - `face_details` → `data.ageRangeLow = STUB_AGE_LOW`, `data.ageRangeHigh = STUB_AGE_LOW + 4` (mapper uses the conservative low bound as `estimatedAge`)
- **Document** (`services: ['ocr','facematch']`):
  - `ocr` → `data.ocr.birthDate = '1995-05-05'`
  - `facematch` → `data.confidence = 92`, `data.identical = true`

## Configuration

| Env var        | Default | Meaning |
|----------------|---------|---------|
| `PORT`         | `8090`  | Listen port |
| `STUB_AGE_LOW` | `25`    | `face_details.ageRangeLow`. `25` → adult/`aprovado`; a grey-zone value (e.g. `17`) → `documento_requerido`. |

## Running

Standalone:

```bash
node tools/caf-stub/server.js
# STUB_AGE_LOW=17 node tools/caf-stub/server.js   # grey-zone (document path)
```

Via Docker Compose (recommended — see repo root):

```bash
docker compose -f docker-compose.yml -f docker-compose.caf.yml up -d --build
```

This adds a `caf-stub` service on `:8090` and overrides `api`/`worker` to use the
CAF providers pointed at `http://caf-stub:8090`. The default
`docker-compose.yml` stays on the `mock` providers.
