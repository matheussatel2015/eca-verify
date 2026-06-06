# Scale smoke

1. Create the temp bucket with a 5-minute TTL lifecycle:
   ```bash
   aws --endpoint-url http://localhost:9000 s3 mb s3://eca-frames-temp
   ```
2. Run migration + seed (from MVP plan), then start API and worker in two shells:
   ```bash
   npx ts-node apps/api/src/main.ts      # shell 1
   npx ts-node apps/api/src/worker.ts    # shell 2
   ```
3. Create a session, then POST /verify and confirm a 202 with status "processando".
4. Confirm the worker logs "job <id> completed" and the tenant webhook fires.
5. Confirm the frame object is gone from the bucket after processing.
6. Hammer /sessions past RATE_LIMIT_PER_MIN to confirm 429.
