import Stripe from 'stripe';
import { PaymentConfig } from '../../config';
import { PaymentPort } from './payment.port';
import { MockPaymentProvider } from './mock-payment';
import { StripeAdapter } from './stripe-adapter';
import { stripePriceFor } from '../stripe-prices';

export function buildPaymentProvider(cfg: PaymentConfig, env: NodeJS.ProcessEnv): PaymentPort {
  if (cfg.kind === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MockPaymentProvider must not run in production — set PAYMENT_PROVIDER_KIND=stripe');
    }
    return new MockPaymentProvider();
  }
  if (!cfg.stripeSecretKey) throw new Error('STRIPE_SECRET_KEY is required for PAYMENT_PROVIDER_KIND=stripe');
  if (!cfg.stripeWebhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is required for PAYMENT_PROVIDER_KIND=stripe');
  const stripe = new Stripe(cfg.stripeSecretKey);
  return new StripeAdapter(stripe, {
    webhookSecret: cfg.stripeWebhookSecret,
    successUrl: cfg.successUrl,
    cancelUrl: cfg.cancelUrl,
    priceFor: (planId: string) => stripePriceFor(planId, env),
  });
}
