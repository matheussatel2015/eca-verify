# Stripe billing smoke

## Mock mode (default — no Stripe account)
1. Register a tenant; with its key:
   `curl -s -X POST http://localhost:3000/billing/checkout -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"plan_id":"pro"}'` → returns a `https://checkout.mock/...` URL.
2. Simulate the webhook (mock provider parses JSON, no signature):
   `curl -s -X POST http://localhost:3000/billing/stripe/webhook -H "Content-Type: application/json" -d '{"tenantId":"<tenant_id>","planId":"pro"}'` → `{received:true,applied:true}`.
3. `GET /billing/plan` → now `plan_id=pro`, quota 10000.

## Real Stripe (sandbox)
Set `PAYMENT_PROVIDER_KIND=stripe`, `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `STRIPE_PRICE_PRO`/`STRIPE_PRICE_SCALE` (test price ids).
1. `POST /billing/checkout {plan_id:pro}` → real Stripe Checkout URL; pay with test card `4242 4242 4242 4242`.
2. Point a Stripe webhook (or `stripe listen --forward-to localhost:3000/billing/stripe/webhook`) → on `checkout.session.completed` the tenant's `plan_id` flips to `pro` and `stripe_customer_id`/`stripe_subscription_id` are stored.
3. Cancel the subscription in Stripe → `customer.subscription.deleted` → tenant downgraded to `free`.
